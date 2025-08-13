const { google } = require('googleapis');
const { YouTubeChannel, UserYouTubeSubscription, YouTubeVideo, User, UserYouTubeVideoInteraction } = require('../models');

class YouTubeService {
  constructor() {
    this.youtube = google.youtube({ 
      version: 'v3'
    });
  }

  /**
   * Fetch new videos for all active YouTube channels
   */
  async fetchNewVideosForAllChannels() {
    console.log('🎬 Starting YouTube video fetch for all channels...');
    
    try {
      // Get all active YouTube channels that users are subscribed to
      const activeChannels = await YouTubeChannel.findAll({
        where: { isActive: true },
        include: [{
          model: UserYouTubeSubscription,
          as: 'userSubscriptions',
          where: { isActive: true },
          required: true
        }]
      });

      console.log(`📺 Found ${activeChannels.length} active channels to check`);

      for (const channel of activeChannels) {
        try {
          await this.fetchVideosForChannel(channel);
          // Small delay to avoid rate limiting
          await this.delay(1000);
        } catch (error) {
          console.error(`❌ Error fetching videos for channel ${channel.name}:`, error.message);
          continue;
        }
      }

      console.log('✅ Completed YouTube video fetch for all channels');
    } catch (error) {
      console.error('❌ Error in fetchNewVideosForAllChannels:', error);
    }
  }

  /**
   * Fetch new videos for a specific channel
   */
  async fetchVideosForChannel(channel) {
    console.log(`🔍 Fetching videos for channel: ${channel.name}`);

    try {
      // Get the latest videos from this channel
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${channel.channelId}&type=video&order=date&maxResults=10&key=${process.env.GOOGLE_API_KEY}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        throw new Error(`YouTube API returned ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        console.log(`📝 No videos found for channel: ${channel.name}`);
        return;
      }

      // Process each video
      let newVideoCount = 0;
      let skippedCount = 0;
      console.log(`📹 Found ${data.items.length} videos from API for channel: ${channel.name}`);
      
      for (const videoItem of data.items) {
        const videoId = videoItem.id.videoId;
        const videoTitle = videoItem.snippet.title;
        const publishedAt = videoItem.snippet.publishedAt;
        
        console.log(`🎥 Processing video: "${videoTitle}" (${videoId}) published: ${publishedAt}`);
        
        // Check if we already have this video
        const existingVideo = await YouTubeVideo.findOne({
          where: { videoId }
        });

        if (existingVideo) {
          console.log(`⏭️  Skipping existing video: ${videoTitle}`);
          skippedCount++;
          continue;
        }

        // Get detailed video information
        const videoDetails = await this.getVideoDetails(videoId);
        if (!videoDetails) continue;

        // Create the video record - auto-approve since users have explicitly subscribed to this channel
        await YouTubeVideo.create({
          videoId: videoId,
          youtubeChannelId: channel.id,
          title: videoDetails.title,
          description: videoDetails.description,
          thumbnail: videoDetails.thumbnail,
          duration: videoDetails.duration,
          publishedAt: new Date(videoDetails.publishedAt),
          viewCount: videoDetails.viewCount,
          likeCount: videoDetails.likeCount,
          videoUrl: `https://youtube.com/watch?v=${videoId}`,
          approvalStatus: 'auto_approved', // Auto-approve since user subscribed to channel
          videoType: this.determineVideoType(videoDetails),
        });

        newVideoCount++;
      }

      // Update channel's lastChecked timestamp
      await channel.update({
        lastChecked: new Date()
      });

      if (newVideoCount > 0) {
        console.log(`✅ Added ${newVideoCount} new videos for channel: ${channel.name} (skipped ${skippedCount} existing)`);
      } else {
        console.log(`📝 No new videos for channel: ${channel.name} (skipped ${skippedCount} existing videos)`);
      }

    } catch (error) {
      console.error(`❌ Error fetching videos for channel ${channel.name}:`, error);
      throw error;
    }
  }

  /**
   * Get detailed video information
   */
  async getVideoDetails(videoId) {
    try {
      const response = await fetch(
        `https://www.googleapis.com/youtube/v3/videos?part=snippet,statistics,contentDetails&id=${videoId}&key=${process.env.GOOGLE_API_KEY}`,
        { method: 'GET' }
      );

      if (!response.ok) {
        throw new Error(`YouTube API returned ${response.status}`);
      }

      const data = await response.json();
      
      if (!data.items || data.items.length === 0) {
        return null;
      }

      const video = data.items[0];
      
      return {
        title: video.snippet.title,
        description: video.snippet.description || '',
        thumbnail: video.snippet.thumbnails?.medium?.url || video.snippet.thumbnails?.default?.url,
        duration: this.parseDuration(video.contentDetails.duration),
        publishedAt: video.snippet.publishedAt,
        viewCount: parseInt(video.statistics.viewCount || 0),
        likeCount: parseInt(video.statistics.likeCount || 0)
      };
    } catch (error) {
      console.error(`❌ Error getting video details for ${videoId}:`, error);
      return null;
    }
  }

  /**
   * Parse YouTube duration format (PT4M13S) to readable format
   */
  parseDuration(duration) {
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return '0:00';

    const hours = (match[1] || '').replace('H', '');
    const minutes = (match[2] || '').replace('M', '');
    const seconds = (match[3] || '').replace('S', '');

    if (hours) {
      return `${hours}:${minutes.padStart(2, '0')}:${seconds.padStart(2, '0')}`;
    }
    return `${minutes || '0'}:${seconds.padStart(2, '0')}`;
  }

  /**
   * Determine video type based on duration and metadata
   */
  determineVideoType(videoDetails) {
    const duration = videoDetails.duration;
    const title = videoDetails.title.toLowerCase();
    
    // Check for YouTube Shorts (typically under 1 minute)
    if (duration && duration.includes(':')) {
      const parts = duration.split(':');
      if (parts.length === 2 && parseInt(parts[0]) === 0 && parseInt(parts[1]) < 60) {
        return 'short';
      }
    }

    // Check for live streams
    if (title.includes('live') || title.includes('stream')) {
      return 'live';
    }

    // Check for premieres
    if (title.includes('premiere')) {
      return 'premiere';
    }

    return 'video';
  }

  /**
   * Get pending videos for a specific user
   */
  async getPendingVideosForUser(userId) {
    try {
      // Get user's subscribed channels
      const userSubscriptions = await UserYouTubeSubscription.findAll({
        where: { 
          userId,
          isActive: true 
        },
        include: [{
          model: YouTubeChannel,
          as: 'youtubeChannel',
          include: [{
            model: YouTubeVideo,
            as: 'videos',
            where: { 
              approvalStatus: 'pending'
            },
            required: false
          }]
        }]
      });

      // Flatten and collect all pending videos
      const pendingVideos = [];
      
      userSubscriptions.forEach(subscription => {
        if (subscription.youtubeChannel && subscription.youtubeChannel.videos) {
          subscription.youtubeChannel.videos.forEach(video => {
            pendingVideos.push({
              ...video.toJSON(),
              channelName: subscription.youtubeChannel.name,
              channelThumbnail: subscription.youtubeChannel.thumbnail
            });
          });
        }
      });

      // Sort by publication date (newest first)
      pendingVideos.sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

      return pendingVideos;
    } catch (error) {
      console.error('❌ Error getting pending videos for user:', error);
      return [];
    }
  }

  /**
   * Get approved videos for a specific user (for dashboard)
   */
  async getApprovedVideosForUser(userId, limit = 20, videoTypeFilter = null) {
    try {
      console.log(`🎬 Getting approved videos for user ${userId}, limit: ${limit}, videoTypeFilter: ${videoTypeFilter}`);
      
      // First, get user's subscribed channels
      const userSubscriptions = await UserYouTubeSubscription.findAll({
        where: { 
          userId,
          isActive: true 
        },
        include: [{
          model: YouTubeChannel,
          as: 'youtubeChannel',
          attributes: ['id', 'name', 'thumbnail']
        }]
      });

      console.log(`📺 Found ${userSubscriptions.length} subscribed channels for user`);

      if (userSubscriptions.length === 0) {
        return [];
      }

      // Get channel IDs
      const channelIds = userSubscriptions
        .map(sub => sub.youtubeChannel?.id)
        .filter(id => id);

      console.log(`🔍 Looking for videos from channel IDs: ${channelIds}`);

      // First, let's see what approval statuses exist for debugging
      const allVideos = await YouTubeVideo.findAll({
        where: {
          youtubeChannelId: { [require('sequelize').Op.in]: channelIds }
        },
        attributes: ['approvalStatus'],
        group: ['approvalStatus']
      });

      console.log(`🔎 All approval statuses in database:`, allVideos.map(v => v.approvalStatus));

      // Check total video count for debugging
      const totalCount = await YouTubeVideo.count({
        where: {
          youtubeChannelId: { [require('sequelize').Op.in]: channelIds }
        }
      });

      console.log(`📊 Total videos in database for these channels: ${totalCount}`);

      // Build the where clause with date filter (last 2 days) and optional video type filter
      const twoDaysAgo = new Date();
      twoDaysAgo.setDate(twoDaysAgo.getDate() - 2);

      const whereClause = {
        youtubeChannelId: { [require('sequelize').Op.in]: channelIds },
        approvalStatus: { [require('sequelize').Op.in]: ['approved', 'auto_approved'] },
        publishedAt: { [require('sequelize').Op.gte]: twoDaysAgo } // Only show videos from last 2 days
      };

      // Add video type filter if specified
      if (videoTypeFilter && videoTypeFilter !== 'all') {
        if (videoTypeFilter === 'regular') {
          whereClause.videoType = 'video'; // 'regular' maps to 'video' in database
        } else {
          whereClause.videoType = videoTypeFilter; // 'short', 'live', 'premiere'
        }
      }

      console.log(`🔍 Filtering videos: published after ${twoDaysAgo.toISOString()}, type: ${videoTypeFilter || 'all'}`);
      console.log(`🔧 Where clause:`, JSON.stringify(whereClause, null, 2));

      // Get all approved videos from these channels, properly sorted
      const videos = await YouTubeVideo.findAll({
        where: whereClause,
        include: [
          {
            model: YouTubeChannel,
            as: 'youtubeChannel',
            attributes: ['name', 'thumbnail']
          },
          {
            model: UserYouTubeVideoInteraction,
            as: 'userInteractions',
            where: { userId: userId },
            required: false
          }
        ],
        order: [['publishedAt', 'DESC']],
        limit: limit
      });

      console.log(`✅ Found ${videos.length} approved videos total`);

      // Format the results
      const approvedVideos = videos.map(video => ({
        ...video.toJSON(),
        channelName: video.youtubeChannel?.name,
        channelThumbnail: video.youtubeChannel?.thumbnail
      }));

      return approvedVideos;
    } catch (error) {
      console.error('❌ Error getting approved videos for user:', error);
      return [];
    }
  }

  /**
   * Utility function for delays
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

module.exports = new YouTubeService();