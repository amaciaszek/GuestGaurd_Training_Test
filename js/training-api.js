// ===== GuestGuard Training API Integration =====
// Server-based authentication and progress tracking - NO localStorage
(function() {
  'use strict';

  window.GGTrainingAPI = {
    // State - Session only (not persisted)
    accessToken: null,
    refreshToken: null,
    expiresAt: null,
    allChapters: {},  // key: "1-1", value: { data: {...}, progress: {...} }
    currentChapterKey: null,
    serverProgress: {},
    
    // All chapter files in the system
    CHAPTER_FILES: [
      "1-1.json", "1-2.json", "1-3.json", "1-4.json", "1-5.json",
      "2-1.json", "2-2.json", "2-3.json",
      "3-1.json", "3-2.json",
      "4-1.json", "4-2.json",
      "5-1.json", "5-2.json", "5-3.json",
      "6-1.json"
    ],
    
    // Initialize the API system
    async init() {
      console.log('🚀 Initializing Training API (Server-based mode)...');
      
      this.setupProgressUI();
      
      // Check for temp_token in URL - ONLY source of authentication
      console.log('🔍 DEBUGGING - Full URL:', window.location.href);
      console.log('🔍 DEBUGGING - Search params:', window.location.search);
      
      const params = new URLSearchParams(window.location.search);
      const tempToken = params.get('temp_token');
      
      console.log('🔍 DEBUGGING - Raw temp_token value:', tempToken);
      console.log('🔍 DEBUGGING - Token type:', typeof tempToken);
      console.log('🔍 DEBUGGING - Token length:', tempToken ? tempToken.length : 0);
      console.log('🔍 DEBUGGING - Token first 50 chars:', tempToken ? tempToken.substring(0, 50) : 'null');
      
      // Inspect token character codes to find hidden characters
      if (tempToken) {
        console.log('🔍 DEBUGGING - Token char codes (first 20):');
        for (let i = 0; i < Math.min(20, tempToken.length); i++) {
          console.log(`  [${i}] = "${tempToken[i]}" (code: ${tempToken.charCodeAt(i)})`);
        }
      }
      
      if (tempToken) {
        console.log('🎫 Temp token detected in URL, authenticating...');
        const success = await this.authenticateWithTempToken(tempToken);
        
        // Clean up URL after authentication attempt
        if (success) {
          console.log('🧹 Removing temp_token from URL');
          const url = new URL(window.location.href);
          url.searchParams.delete('temp_token');
          window.history.replaceState({}, '', url.toString());
        }
      } else {
        console.log('⚠️ No temp_token in URL - authentication required');
        this.updateAuthStatus();
        this.showAuthRequiredMessage();
      }
    },
    
    // Show authentication required message
    showAuthRequiredMessage() {
      document.getElementById('moduleTitle').textContent = 'Please authenticate to continue';
      const stage = document.getElementById('stage');
      stage.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:#9fb0c5;font-size:18px;">🔒 Authentication Required</div>';
    },
    
    // Retry wrapper for fetch operations with exponential backoff
    async fetchWithRetry(fetchFn, maxRetries = null, operation = 'Operation') {
      const retries = maxRetries !== null ? maxRetries : (typeof SERVER_RETRY_ATTEMPTS !== 'undefined' ? SERVER_RETRY_ATTEMPTS : 3);
      const baseDelay = typeof SERVER_RETRY_BASE_DELAY !== 'undefined' ? SERVER_RETRY_BASE_DELAY : 1000;
      
      for (let attempt = 1; attempt <= retries; attempt++) {
        try {
          console.log(`🔄 ${operation} - Attempt ${attempt}/${retries}`);
          const result = await fetchFn();
          
          if (attempt > 1) {
            console.log(`✅ ${operation} succeeded on attempt ${attempt}`);
          }
          
          return { success: true, data: result };
        } catch (error) {
          console.error(`❌ ${operation} failed on attempt ${attempt}:`, error.message);
          
          if (attempt < retries) {
            // Calculate exponential backoff delay: baseDelay * 2^(attempt-1)
            const delay = baseDelay * Math.pow(2, attempt - 1);
            console.log(`⏳ Waiting ${delay}ms before retry...`);
            await new Promise(resolve => setTimeout(resolve, delay));
          } else {
            console.error(`💥 ${operation} failed after ${retries} attempts`);
            return { success: false, error: error.message };
          }
        }
      }
      
      return { success: false, error: 'Max retries exceeded' };
    },
    
    // Clear authentication (session only - no localStorage)
    clearAuth() {
      this.accessToken = null;
      this.refreshToken = null;
      this.expiresAt = null;
      this.allChapters = {};
      this.currentChapterKey = null;
      this.serverProgress = {};
      console.log('🗑️ Session auth cleared (no localStorage)');
    },
    
    // Update authentication status display
    updateAuthStatus() {
      const statusEl = document.getElementById('authStatus');
      
      if (this.accessToken && this.expiresAt) {
        const expiresIn = Math.floor((this.expiresAt - Date.now()) / 1000);
        
        if (expiresIn > 0) {
          statusEl.className = 'auth-status ok';
          statusEl.textContent = `✓ Authenticated (expires in ${expiresIn}s)`;
          
          // Update every second
          if (!this._statusInterval) {
            this._statusInterval = setInterval(() => {
              this.updateAuthStatus();
            }, 1000);
          }
        } else {
          statusEl.className = 'auth-status bad';
          statusEl.textContent = '✗ Token Expired - Refresh page with new token';
          if (this._statusInterval) {
            clearInterval(this._statusInterval);
            this._statusInterval = null;
          }
        }
      } else {
        statusEl.className = 'auth-status bad';
        statusEl.textContent = '✗ Not Authenticated';
        if (this._statusInterval) {
          clearInterval(this._statusInterval);
          this._statusInterval = null;
        }
      }
    },
    
    // Authenticate with temporary token
    async authenticateWithTempToken(tempToken) {
      try {
        console.log('🔑 Exchanging temp token...');
        console.log('🔍 DEBUGGING - Token being exchanged:', tempToken);
        console.log('🔍 DEBUGGING - Token length:', tempToken.length);
        console.log('🔍 DEBUGGING - Encoded token:', encodeURIComponent(tempToken));
        
        const apiUrl = `${API_BASE}/api/training-auth?temp_token=${encodeURIComponent(tempToken)}`;
        console.log('🔍 DEBUGGING - Full API URL:', apiUrl);
        console.log('🔍 DEBUGGING - API_BASE:', API_BASE);
        
        const response = await fetch(apiUrl, {
          method: 'GET',
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'TrainingPlatform/1.0'
          }
        });
        
        console.log('🔍 DEBUGGING - Response status:', response.status);
        console.log('🔍 DEBUGGING - Response ok:', response.ok);
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          console.error('🔍 DEBUGGING - Error response:', errorData);
          throw new Error(`Token exchange failed: ${errorData.error || response.statusText}`);
        }
        
        const authData = await response.json();
        console.log('✅ Token exchange successful');
        console.log('🔍 DEBUGGING - Auth data received:', authData);
        console.log('🔍 DEBUGGING - Full auth data:', JSON.stringify(authData, null, 2));
        console.log('🔍 DEBUGGING - Access token (first 20 chars):', authData.access_token ? authData.access_token.substring(0, 20) : 'null');
        console.log('🔍 DEBUGGING - Refresh token exists:', !!authData.refresh_token);
        console.log('🔍 DEBUGGING - Expires at (from server):', authData.expires_at);
        
        // Handle missing expires_at - calculate default expiration (1 hour from now)
        let expiresAt = authData.expires_at;
        if (!expiresAt) {
          // If server doesn't provide expires_at, default to 1 hour from now
          expiresAt = Date.now() + (60 * 60 * 1000); // 1 hour in milliseconds
          console.warn('⚠️ Server did not provide expires_at, using default: 1 hour from now');
          console.log('🔍 DEBUGGING - Calculated expires_at:', expiresAt);
        }
        
        // Store auth data in memory only (no localStorage)
        this.accessToken = authData.access_token;
        this.refreshToken = authData.refresh_token;
        this.expiresAt = expiresAt;
        console.log('💾 Auth stored in session memory (NOT localStorage)');
        console.log('🔍 DEBUGGING - Stored accessToken exists:', !!this.accessToken);
        console.log('🔍 DEBUGGING - Stored expiresAt:', this.expiresAt);
        console.log('🔍 DEBUGGING - Token expires in:', Math.floor((this.expiresAt - Date.now()) / 1000), 'seconds');
        
        this.updateAuthStatus();
        
        // Load all chapters and progress from server
        await this.loadAllChaptersAndProgress();
        
        return true;
      } catch (e) {
        console.error('❌ Authentication failed:', e.message);
        console.error('🔍 DEBUGGING - Full error:', e);
        console.error('🔍 DEBUGGING - Error stack:', e.stack);
        
        // Update status to show error
        const statusEl = document.getElementById('authStatus');
        if (statusEl) {
          statusEl.className = 'auth-status bad';
          statusEl.textContent = `✗ Authentication Failed: ${e.message}`;
        }
        
        return false;
      }
    },
    
    // Fetch with authentication header
    async fetchWithAuth(url, options = {}) {
      if (!this.accessToken) {
        throw new Error('Not authenticated');
      }
      
      const headers = {
        ...options.headers,
        'Authorization': `Bearer ${this.accessToken}`
      };
      
      return fetch(url, { ...options, headers });
    },
    
    // Parse chapter key (e.g., "2-1" -> { module: 2, chapter: 0 })
    parseChapterKey(key) {
      const match = key.match(/(\d+)-(\d+)/);
      if (!match) return null;
      return {
        module: parseInt(match[1]),
        chapter: parseInt(match[2]) - 1  // 0-based
      };
    },
    
    // Load all chapter JSONs and fetch progress from server
    async loadAllChaptersAndProgress() {
      if (!this.accessToken) {
        console.warn('⚠️ Cannot load chapters without authentication');
        return;
      }
      
      try {
        console.log('📚 Loading all chapters...');
        document.getElementById('moduleTitle').textContent = 'Loading chapters and progress...';
        
        // Load all chapter JSON files
        const loadPromises = this.CHAPTER_FILES.map(async (filename) => {
          try {
            const response = await fetch(`json/${filename}`);
            if (!response.ok) throw new Error(`Failed to load ${filename}`);
            const data = await response.json();
            
            const key = filename.replace('.json', '');
            
            // Get accurate segment count from SEGMENT_TIMINGS
            let segmentCount = 0;
            if (window.SEGMENT_TIMINGS && window.SEGMENT_TIMINGS[key]) {
              segmentCount = window.SEGMENT_TIMINGS[key].segments.length;
              console.log(`✓ Loaded ${filename} - ${segmentCount} segments (from SEGMENT_TIMINGS)`);
            } else {
              // Fallback to analyzing JSON structure
              if (data.content) segmentCount = data.content.length;
              else if (data.segments) segmentCount = data.segments.length;
              else if (data.hotspots) segmentCount = data.hotspots.length;
              console.log(`✓ Loaded ${filename} - ${segmentCount} segments (from JSON structure)`);
            }
            
            this.allChapters[key] = {
              data: data,
              progress: {
                currentSegment: 0,
                totalSegments: segmentCount,
                completed: false,
                lastUpdated: null
              }
            };
            
          } catch (e) {
            console.error(`✗ Failed to load ${filename}:`, e.message);
          }
        });
        
        await Promise.all(loadPromises);
        console.log('✅ All chapters loaded');
        
        // Show initial progress display with local data (even if all 0%)
        console.log('📊 Displaying initial progress with local chapter structure...');
        this.updateProgressDisplay({ modules: {} });
        
        // Fetch progress from server
        await this.fetchProgressFromServer();
        
        // Find the last completed segment and resume
        this.resumeFromLastProgress();
        
      } catch (e) {
        console.error('❌ Failed to load chapters:', e.message);
        document.getElementById('moduleTitle').textContent = 'Failed to load chapters';
      }
    },
    
    // Count total segments in a chapter
    countSegments(chapterData) {
      // First try to use the accurate SEGMENT_TIMINGS data from config
      const key = this.currentChapterKey;
      if (key && window.SEGMENT_TIMINGS && window.SEGMENT_TIMINGS[key]) {
        const count = window.SEGMENT_TIMINGS[key].segments.length;
        console.log(`✅ Using SEGMENT_TIMINGS for ${key}: ${count} segments`);
        return count;
      }
      
      // Fallback to checking chapterData structure
      if (chapterData) {
        if (chapterData.content && Array.isArray(chapterData.content)) {
          return chapterData.content.length;
        }
        if (chapterData.segments && Array.isArray(chapterData.segments)) {
          return chapterData.segments.length;
        }
        if (chapterData.hotspots && Array.isArray(chapterData.hotspots)) {
          return chapterData.hotspots.length;
        }
      }
      
      console.warn(`⚠️ Could not count segments for chapter, returning 0`);
      return 0;
    },
    
    // Get total duration for a chapter in seconds
    getChapterDuration(chapterKey) {
      if (window.TIMING_TOTALS && window.TIMING_TOTALS[chapterKey]) {
        return window.TIMING_TOTALS[chapterKey];
      }
      return 0;
    },
    
    // Get segment names for a chapter
    getSegmentNames(chapterKey) {
      if (window.SEGMENT_TIMINGS && window.SEGMENT_TIMINGS[chapterKey]) {
        return window.SEGMENT_TIMINGS[chapterKey].segments;
      }
      return [];
    },
    
    // Fetch progress from server
    async fetchProgressFromServer() {
      if (!this.accessToken) return;
      
      try {
        console.log('📥 Fetching progress from server...');
        
        const response = await this.fetchWithAuth(`${API_BASE}/api/training-progress`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' }
        });
        
        if (!response.ok) {
          throw new Error(`${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ Progress fetched from server:', data);
        console.log('🔍 DEBUGGING - Full progress response:', JSON.stringify(data, null, 2));
        console.log('🔍 DEBUGGING - Has training_progress field:', !!data.training_progress);
        console.log('🔍 DEBUGGING - Has modules field:', !!(data.training_progress && data.training_progress.modules));
        
        if (data.training_progress && data.training_progress.modules) {
          console.log('🔍 DEBUGGING - Modules in response:', Object.keys(data.training_progress.modules));
          // Show first module's structure for debugging
          const firstModule = Object.keys(data.training_progress.modules)[0];
          if (firstModule) {
            console.log(`🔍 DEBUGGING - Structure of ${firstModule}:`, JSON.stringify(data.training_progress.modules[firstModule], null, 2));
          }
        }
        
        this.serverProgress = data.training_progress || {};
        
        // Apply server progress to local chapters
        this.applyServerProgress();
        
        // Update progress display
        this.updateProgressDisplay(this.serverProgress);
        
      } catch (e) {
        console.error('❌ Failed to fetch progress:', e.message);
      }
    },
    
    // Apply server progress to local chapter objects
    applyServerProgress() {
      if (!this.serverProgress || !this.serverProgress.modules) {
        console.log('⚠️ No server progress to apply');
        console.log('🔍 DEBUGGING - serverProgress:', this.serverProgress);
        return;
      }
      
      console.log('📝 Applying server progress to local chapters...');
      console.log('🔍 DEBUGGING - Server modules:', Object.keys(this.serverProgress.modules));
      
      let appliedCount = 0;
      
      for (const [key, chapter] of Object.entries(this.allChapters)) {
        const parsed = this.parseChapterKey(key);
        if (!parsed) {
          console.log(`  ⚠️ Could not parse key: ${key}`);
          continue;
        }
        
        const moduleKey = `module_${parsed.module}`;
        const moduleData = this.serverProgress.modules[moduleKey];
        
        console.log(`  🔍 Checking ${key}: moduleKey=${moduleKey}, moduleData exists=${!!moduleData}`);
        
        if (moduleData && moduleData.chapters && moduleData.chapters[parsed.chapter]) {
          const serverChapterProgress = moduleData.chapters[parsed.chapter];
          
          console.log(`  📝 Applying progress for ${key}:`, serverChapterProgress);
          
          chapter.progress.currentSegment = serverChapterProgress.current_segment || 0;
          chapter.progress.completed = serverChapterProgress.completed || false;
          chapter.progress.lastUpdated = serverChapterProgress.last_updated || null;
          
          console.log(`  ✓ Applied progress for ${key}: segment ${chapter.progress.currentSegment}/${chapter.progress.totalSegments}${chapter.progress.completed ? ' (COMPLETED)' : ''}`);
          appliedCount++;
        } else {
          console.log(`  ⚠️ No server progress for ${key} (module: ${moduleKey}, chapter index: ${parsed.chapter})`);
        }
      }
      
      console.log(`✅ Server progress applied to ${appliedCount} chapters`);
    },
    
    // Report progress to server
    async reportProgress(chapterKey, segmentIndex, completed = false) {
      if (!this.accessToken) {
        console.warn('⚠️ Cannot report progress without authentication');
        return { success: false };
      }
      
      const parsed = this.parseChapterKey(chapterKey);
      if (!parsed) {
        console.error('❌ Invalid chapter key:', chapterKey);
        return { success: false };
      }
      
      const payload = {
        module_number: parsed.module,
        chapter_index: parsed.chapter,
        segment_index: segmentIndex,
        completed: completed
      };
      
      console.log(`📤 Reporting progress to server: ${chapterKey} segment ${segmentIndex}${completed ? ' (COMPLETED)' : ''}`);
      console.log('🔍 DEBUGGING - Progress payload:', JSON.stringify(payload, null, 2));
      
      const result = await this.fetchWithRetry(
        async () => {
          const response = await this.fetchWithAuth(`${API_BASE}/api/training-progress`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json'
            },
            body: JSON.stringify(payload)
          });
          
          if (!response.ok) {
            const errorData = await response.json().catch(() => ({}));
            throw new Error(`Progress report failed: ${errorData.error || response.statusText}`);
          }
          
          const data = await response.json();
          console.log('✅ Progress reported successfully:', data);
          console.log('🔍 DEBUGGING - Server response:', JSON.stringify(data, null, 2));
          
          // Update local progress with server response
          if (data.training_progress) {
            console.log('🔍 DEBUGGING - Updating local progress with server response');
            this.serverProgress = data.training_progress;
            this.applyServerProgress();
          } else {
            console.warn('⚠️ Server response did not include training_progress');
          }
          
          return data;
        },
        3, // retry attempts
        `Report Progress (${chapterKey}:${segmentIndex})`
      );
      
      if (result.success) {
        // Refresh progress display after successful report
        this.updateProgressDisplay(this.serverProgress);
      }
      
      return result;
    },
    
    // Resume from last progress
    resumeFromLastProgress() {
      console.log('🔍 Finding last progress position...');
      
      let lastChapterKey = null;
      let lastSegmentIndex = 0;
      
      // Iterate through chapters in order
      for (const filename of this.CHAPTER_FILES) {
        const key = filename.replace('.json', '');
        const chapter = this.allChapters[key];
        
        if (chapter && chapter.progress) {
          if (chapter.progress.completed) {
            // If completed, this is the last completed chapter
            lastChapterKey = key;
            lastSegmentIndex = chapter.progress.totalSegments;
          } else if (chapter.progress.currentSegment > 0) {
            // If in progress, this is where we resume
            lastChapterKey = key;
            lastSegmentIndex = chapter.progress.currentSegment;
            break; // Stop here, we found the resume point
          } else {
            // Not started yet, this is our resume point if no others found
            if (!lastChapterKey || lastSegmentIndex === chapter.progress.totalSegments) {
              lastChapterKey = key;
              lastSegmentIndex = 0;
              break;
            }
          }
        }
      }
      
      // If we found a resume point, load that chapter
      if (lastChapterKey) {
        console.log(`✅ Resuming from ${lastChapterKey} segment ${lastSegmentIndex}`);
        this.loadChapter(lastChapterKey);
      } else {
        console.log('⚠️ No progress found, starting from beginning');
        this.loadChapter(this.CHAPTER_FILES[0].replace('.json', ''));
      }
    },
    
    // Load a specific chapter
    loadChapter(chapterKey) {
      const chapter = this.allChapters[chapterKey];
      if (!chapter) {
        console.error(`❌ Chapter ${chapterKey} not found`);
        return;
      }
      
      console.log(`📖 Loading chapter ${chapterKey}...`);
      this.currentChapterKey = chapterKey;
      
      // Update title
      const parsed = this.parseChapterKey(chapterKey);
      if (parsed) {
        const moduleObj = TRAINING_STRUCTURE.find(m => m.id === `module-${parsed.module}`);
        if (moduleObj && moduleObj.chapters[parsed.chapter]) {
          document.getElementById('moduleTitle').textContent = moduleObj.chapters[parsed.chapter].name;
        }
      }
      
      // Initialize the training system with this chapter
      if (window.initTrainingSystem) {
        window.initTrainingSystem(chapter.data, chapterKey);
      }
    },
    
    // Get next chapter
    getNextChapter() {
      const currentIndex = this.CHAPTER_FILES.findIndex(f => f.replace('.json', '') === this.currentChapterKey);
      if (currentIndex === -1 || currentIndex === this.CHAPTER_FILES.length - 1) {
        return null; // No next chapter
      }
      return this.CHAPTER_FILES[currentIndex + 1].replace('.json', '');
    },
    
    // Update progress display panel
    updateProgressDisplay(progressData) {
      console.log('\n===== UPDATING PROGRESS DISPLAY =====');
      console.log('Progress data:', progressData);
      
      const moduleList = document.getElementById('moduleList');
      if (!moduleList) {
        console.warn('⚠️ Module list element not found');
        return;
      }
      
      moduleList.innerHTML = '';
      
      // Group chapters by module
      const moduleGroups = {};
      for (const [key, chapter] of Object.entries(this.allChapters)) {
        const parsed = this.parseChapterKey(key);
        if (!parsed) continue;
        
        if (!moduleGroups[parsed.module]) {
          moduleGroups[parsed.module] = [];
        }
        moduleGroups[parsed.module].push({ key, chapter, parsed });
      }
      
      // Display each module
      for (const [modNum, chapters] of Object.entries(moduleGroups).sort((a, b) => parseInt(a[0]) - parseInt(b[0]))) {
        console.log(`\nModule ${modNum}:`);
        
        let modTotalSegments = 0;
        let modCompletedSegments = 0;
        let modTotalSeconds = 0;
        let modCompletedSeconds = 0;
        let chapterDetailsHTML = '';
        
        chapters.sort((a, b) => a.parsed.chapter - b.parsed.chapter).forEach(({ key, chapter }) => {
          const chapterData = chapter.data;
          const chapterProgress = chapter.progress;
          
          if (chapterData && chapterProgress) {
            const total = chapterProgress.totalSegments;
            const current = chapterProgress.currentSegment;
            const isCompleted = chapterProgress.completed;
            
            modTotalSegments += total;
            modCompletedSegments += isCompleted ? total : current;
            
            const percent = total > 0 ? Math.round((current / total) * 100) : 0;
            console.log(`  ${key}: ${current}/${total} = ${percent}%${isCompleted ? ' ✓' : ''}`);
            
            // Calculate time-based progress
            const chapterDuration = this.getChapterDuration(key);
            const segmentDurations = window.SEGMENT_TIMINGS && window.SEGMENT_TIMINGS[key] 
              ? window.SEGMENT_TIMINGS[key].durations 
              : [];
            
            let chapterCompletedTime = 0;
            if (segmentDurations.length > 0) {
              for (let i = 0; i < Math.min(current, segmentDurations.length); i++) {
                chapterCompletedTime += segmentDurations[i];
              }
            }
            
            modTotalSeconds += chapterDuration;
            modCompletedSeconds += chapterCompletedTime;
            
            // Find chapter name from TRAINING_STRUCTURE
            let chapterName = `Chapter ${key.split('-')[1]}`;
            const moduleObj = TRAINING_STRUCTURE.find(m => m.id === `module-${modNum}`);
            if (moduleObj) {
              const chapterObj = moduleObj.chapters.find(c => c.id === `chapter-${key}`);
              if (chapterObj) {
                chapterName = chapterObj.name;
              }
            }
            
            // Format time display
            let timeDisplay = '';
            if (chapterDuration > 0) {
              const compMin = Math.floor(chapterCompletedTime / 60);
              const compSec = chapterCompletedTime % 60;
              const totMin = Math.floor(chapterDuration / 60);
              const totSec = chapterDuration % 60;
              timeDisplay = `${compMin}:${compSec.toString().padStart(2,'0')} / ${totMin}:${totSec.toString().padStart(2,'0')}`;
            } else {
              timeDisplay = `${current}/${total} segments`;
            }
            
            chapterDetailsHTML += `
              <div style="padding: 6px 0; border-top: 1px solid rgba(29, 39, 51, 0.5);">
                <div style="display: flex; justify-content: space-between; margin-bottom: 3px;">
                  <div style="font-size: 10px; color: #9fb0c5;">${chapterName}</div>
                  <div style="font-size: 10px; color: ${percent === 100 ? '#7CFCB5' : '#9fb0c5'}; font-weight: 600;">
                    ${percent}%
                  </div>
                </div>
                <div style="background: #05080c; height: 3px; border-radius: 1.5px; overflow: hidden;">
                  <div style="background: ${percent === 100 ? '#7CFCB5' : '#00e0ff'}; height: 100%; width: ${percent}%; transition: width 0.3s;"></div>
                </div>
                <div style="font-size: 9px; color: #6b7a8f; margin-top: 2px;">${timeDisplay}</div>
              </div>
            `;
          } else {
            console.warn(`    ${key}: chapter data not found!`);
          }
        });
        
        // Use time-based module percentage if available
        const modPercent = modTotalSeconds > 0
          ? Math.round((modCompletedSeconds / modTotalSeconds) * 100)
          : modTotalSegments > 0
            ? Math.round((modCompletedSegments / modTotalSegments) * 100)
            : 0;
        
        console.log(`  Module ${modNum} total: ${modCompletedSegments}/${modTotalSegments} = ${modPercent}% (${modCompletedSeconds}/${modTotalSeconds}s)`);
        
        // Find module name from TRAINING_STRUCTURE
        let moduleName = `Module ${modNum}`;
        const moduleObj = TRAINING_STRUCTURE.find(m => m.id === `module-${modNum}`);
        if (moduleObj) {
          moduleName = moduleObj.name;
        }
        
        // Format module time display
        let moduleTimeDisplay = '';
        if (modTotalSeconds > 0) {
          const compMin = Math.floor(modCompletedSeconds / 60);
          const compSec = modCompletedSeconds % 60;
          const totMin = Math.floor(modTotalSeconds / 60);
          const totSec = modTotalSeconds % 60;
          moduleTimeDisplay = `${compMin}:${compSec.toString().padStart(2,'0')} / ${totMin}:${totSec.toString().padStart(2,'0')}`;
        } else {
          moduleTimeDisplay = `${modCompletedSegments}/${modTotalSegments} segments`;
        }
        
        const moduleDiv = document.createElement('div');
        moduleDiv.style.cssText = `
          background: rgba(5, 8, 12, 0.6);
          border: 1px solid #1d2733;
          border-radius: 10px;
          padding: 12px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: all 0.2s;
        `;
        
        moduleDiv.innerHTML = `
          <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 8px;">
            <div style="font-size: 12px; font-weight: 700; color: #00e0ff;">${moduleName}</div>
            <div style="font-size: 16px; font-weight: 700; color: ${modPercent === 100 ? '#7CFCB5' : modPercent > 0 ? '#7cf6c9' : '#9fb0c5'};">
              ${modPercent}%
            </div>
          </div>
          <div style="background: #05080c; height: 5px; border-radius: 2.5px; overflow: hidden; margin-bottom: 6px;">
            <div style="background: linear-gradient(90deg, #00e0ff, ${modPercent === 100 ? '#7CFCB5' : '#7cf6c9'}); height: 100%; width: ${modPercent}%; transition: width 0.3s;"></div>
          </div>
          <div style="font-size: 10px; color: #9fb0c5; font-family: monospace;">
            ${chapters.length} chapter${chapters.length !== 1 ? 's' : ''} • ${moduleTimeDisplay}
            ${modPercent === 100 ? '<span style="color: #7CFCB5; margin-left: 6px;">✓ Complete</span>' : ''}
          </div>
          <div class="chapter-details" style="display: none; margin-top: 8px;">
            ${chapterDetailsHTML}
          </div>
        `;
        
        // Add click handler to expand/collapse chapter details
        moduleDiv.addEventListener('click', (e) => {
          const detailsEl = moduleDiv.querySelector('.chapter-details');
          if (detailsEl) {
            const isExpanded = detailsEl.style.display !== 'none';
            detailsEl.style.display = isExpanded ? 'none' : 'block';
            moduleDiv.style.background = isExpanded 
              ? 'rgba(5, 8, 12, 0.6)' 
              : 'rgba(0, 224, 255, 0.05)';
          }
        });
        
        moduleList.appendChild(moduleDiv);
      }
      
      console.log('\n===== END PROGRESS DISPLAY UPDATE =====\n');
    },
    
    // Setup progress panel UI
    setupProgressUI() {
      const toggleBtn = document.getElementById('toggleProgressBtn');
      const panel = document.getElementById('progressPanel');
      const closeBtn = document.getElementById('closePanelBtn');
      const refreshBtn = document.getElementById('refreshProgressBtn');
      
      if (toggleBtn && panel && closeBtn) {
        toggleBtn.addEventListener('click', () => {
          const isVisible = panel.style.display !== 'none';
          panel.style.display = isVisible ? 'none' : 'block';
          if (!isVisible && this.accessToken) {
            console.log('🔄 Progress panel opened - refreshing from server...');
            this.fetchProgressFromServer();
          } else if (!isVisible) {
            console.log('🔄 Progress panel opened - updating display with local data...');
            this.updateProgressDisplay(this.serverProgress || { modules: {} });
          }
        });
        
        closeBtn.addEventListener('click', () => {
          panel.style.display = 'none';
        });
        
        if (refreshBtn) {
          refreshBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            console.log('🔄 Manual refresh button clicked');
            
            if (this.accessToken) {
              refreshBtn.textContent = '⏳';
              refreshBtn.disabled = true;
              this.fetchProgressFromServer().then(() => {
                refreshBtn.textContent = '✓';
                setTimeout(() => {
                  refreshBtn.textContent = '🔄';
                  refreshBtn.disabled = false;
                }, 1000);
              }).catch(() => {
                refreshBtn.textContent = '✗';
                setTimeout(() => {
                  refreshBtn.textContent = '🔄';
                  refreshBtn.disabled = false;
                }, 2000);
              });
            } else {
              alert('Not authenticated. Please refresh page with authentication token.');
            }
          });
        }
      }
      
      // Add console helper for debugging
      window.refreshProgress = () => {
        console.log('🔄 Manual progress refresh triggered...');
        if (this.accessToken) {
          this.fetchProgressFromServer();
        } else {
          console.warn('⚠️ Not authenticated - cannot fetch from server');
          this.updateProgressDisplay(this.serverProgress || { modules: {} });
        }
      };
      
      console.log('💡 Debug helper: Type "refreshProgress()" in console to manually refresh progress panel');
    }
  };
  
  // Initialize when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => window.GGTrainingAPI.init());
  } else {
    window.GGTrainingAPI.init();
  }
})();
