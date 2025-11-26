// ===== GuestGuard Training API Integration =====
// Rewritten to use chapter-test.html authentication pattern
(function() {
  'use strict';

  window.GGTrainingAPI = {
    // State
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
      console.log('🚀 Initializing Training API...');
      
      this.setupProgressUI();
      this.loadStoredAuth();
      
      // Check for temp_token in URL
      const params = new URLSearchParams(window.location.search);
      const tempToken = params.get('temp_token');
      
      if (tempToken) {
        document.getElementById('tempTokenInput').value = tempToken;
        console.log('🎫 Temp token detected in URL, authenticating...');
        await this.authenticateWithTempToken(tempToken);
      } else if (this.accessToken) {
        console.log('✅ Using stored authentication');
        this.updateAuthStatus();
        await this.loadAllChaptersAndProgress();
      } else {
        console.log('⚠️ No authentication found');
        this.updateAuthStatus();
      }
    },
    
    // Load stored authentication from localStorage
    loadStoredAuth() {
      const access = localStorage.getItem('gg_access_token');
      const refresh = localStorage.getItem('gg_refresh_token');
      const expires = localStorage.getItem('gg_expires_at');
      
      if (access) {
        this.accessToken = access;
        this.refreshToken = refresh;
        this.expiresAt = expires ? parseInt(expires) : null;
        console.log('📦 Loaded stored auth');
        
        // Check if token is expired
        if (this.expiresAt && this.expiresAt < Date.now()) {
          console.log('⏰ Token expired, clearing...');
          this.clearAuth();
        }
      }
    },
    
    // Save authentication to localStorage
    saveAuth(access, refresh, expiresAt) {
      localStorage.setItem('gg_access_token', access);
      localStorage.setItem('gg_refresh_token', refresh);
      localStorage.setItem('gg_expires_at', expiresAt);
      this.accessToken = access;
      this.refreshToken = refresh;
      this.expiresAt = expiresAt;
      console.log('💾 Auth saved to localStorage');
    },
    
    // Clear authentication
    clearAuth() {
      localStorage.removeItem('gg_access_token');
      localStorage.removeItem('gg_refresh_token');
      localStorage.removeItem('gg_expires_at');
      this.accessToken = null;
      this.refreshToken = null;
      this.expiresAt = null;
      this.allChapters = {};
      this.currentChapterKey = null;
      this.serverProgress = {};
      console.log('🗑️ Auth cleared');
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
          statusEl.textContent = '✗ Token Expired';
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
        
        const response = await fetch(
          `${API_BASE}/api/training-auth?temp_token=${encodeURIComponent(tempToken)}`,
          {
            method: 'GET',
            headers: {
              'Accept': 'application/json',
              'User-Agent': 'TrainingPlatform/1.0'
            }
          }
        );
        
        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(`Token exchange failed: ${errorData.error || response.statusText}`);
        }
        
        const authData = await response.json();
        console.log('✅ Token exchange successful');
        
        // Save auth data
        this.saveAuth(
          authData.access_token,
          authData.refresh_token,
          authData.expires_at
        );
        
        this.updateAuthStatus();
        
        // Load all chapters and progress
        await this.loadAllChaptersAndProgress();
        
        return true;
      } catch (e) {
        console.error('❌ Authentication failed:', e.message);
        alert('Authentication failed: ' + e.message);
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
        console.log('✅ Progress fetched:', data);
        
        this.serverProgress = data.training_progress || {};
        
        // Apply server progress to local chapters
        this.applyServerProgress();
        
        // Update progress display
        this.updateProgressDisplay(this.serverProgress);
        
      } catch (e) {
        console.error('❌ Failed to fetch progress:', e.message);
      }
    },
    
    // Apply server progress to local chapter data
    applyServerProgress() {
      const modules = this.serverProgress.modules || {};
      
      for (const key in this.allChapters) {
        const { module, chapter } = this.parseChapterKey(key);
        
        if (modules[module] && modules[module].chapters && modules[module].chapters[chapter]) {
          const serverChapterProgress = modules[module].chapters[chapter];
          
          this.allChapters[key].progress = {
            currentSegment: serverChapterProgress.currentSegment || 0,
            totalSegments: this.allChapters[key].progress.totalSegments,
            completed: serverChapterProgress.completed || false,
            lastUpdated: serverChapterProgress.lastUpdated
          };
          
          console.log(`📍 Applied progress for ${key}: segment ${serverChapterProgress.currentSegment}`);
        }
      }
    },
    
    // Resume from last progress
    resumeFromLastProgress() {
      console.log('\n🔍 ===== AUTO-RESUME: DETERMINING WHICH CHAPTER TO LOAD =====');
      console.log('This system automatically takes you to your last active chapter');
      
      // Separate chapters into categories
      const incompleteWithProgress = [];
      const completed = [];
      const notStarted = [];
      
      for (const key in this.allChapters) {
        const chapter = this.allChapters[key];
        const progress = chapter.progress;
        
        const isCompleted = progress.completed || 
                           (progress.currentSegment >= progress.totalSegments && progress.totalSegments > 0);
        
        const hasProgress = progress.currentSegment > 0;
        
        console.log(`📊 ${key}: ${progress.currentSegment}/${progress.totalSegments} segments | ` +
                   `completed: ${isCompleted} | lastUpdated: ${progress.lastUpdated || 'never'}`);
        
        if (isCompleted) {
          completed.push({ key, ...progress });
        } else if (hasProgress) {
          incompleteWithProgress.push({ key, ...progress });
        } else {
          notStarted.push({ key, ...progress });
        }
      }
      
      console.log(`\n📈 Summary:`);
      console.log(`  - Completed chapters: ${completed.length}`);
      console.log(`  - Incomplete with progress: ${incompleteWithProgress.length}`);
      console.log(`  - Not started: ${notStarted.length}`);
      
      let targetKey = null;
      let reason = '';
      
      // Priority 1: Resume incomplete chapter with most recent progress
      if (incompleteWithProgress.length > 0) {
        // Sort by lastUpdated timestamp (most recent first)
        incompleteWithProgress.sort((a, b) => {
          const timeA = a.lastUpdated ? new Date(a.lastUpdated).getTime() : 0;
          const timeB = b.lastUpdated ? new Date(b.lastUpdated).getTime() : 0;
          return timeB - timeA; // Most recent first
        });
        
        targetKey = incompleteWithProgress[0].key;
        const lastUpdate = incompleteWithProgress[0].lastUpdated 
          ? new Date(incompleteWithProgress[0].lastUpdated).toLocaleString()
          : 'unknown';
        reason = `📍 RESUMING: Most recent incomplete chapter (${incompleteWithProgress[0].currentSegment}/${incompleteWithProgress[0].totalSegments} segments, last updated: ${lastUpdate})`;
      }
      // Priority 2: Start first not-started chapter
      else if (notStarted.length > 0) {
        // Find first chapter in sequence order
        const ordered = this.CHAPTER_FILES.filter(f => 
          notStarted.some(ns => ns.key === f.replace('.json', ''))
        );
        
        if (ordered.length > 0) {
          targetKey = ordered[0].replace('.json', '');
          reason = '🆕 Starting first chapter with no progress';
        }
      }
      // Priority 3: All chapters completed - go to first chapter
      else if (completed.length > 0) {
        targetKey = '1-1';
        reason = '🎉 All chapters completed - returning to start';
        console.log('🎉 Congratulations! All chapters completed!');
      }
      // Fallback: Start from beginning
      else {
        targetKey = '1-1';
        reason = '🆕 No progress data - starting from beginning';
      }
      
      console.log(`\n✅ AUTO-RESUME DECISION: Load ${targetKey}`);
      console.log(`   ${reason}`);
      console.log('===== END AUTO-RESUME =====\n');
      
      this.currentChapterKey = targetKey;
      this.loadCurrentChapter();
    },
    
    // Load current chapter into the training system
    loadCurrentChapter() {
      if (!this.currentChapterKey || !this.allChapters[this.currentChapterKey]) {
        console.error('❌ Cannot load chapter:', this.currentChapterKey);
        return;
      }
      
      const chapter = this.allChapters[this.currentChapterKey];
      console.log(`📖 Loading chapter ${this.currentChapterKey}...`);
      
      // Reset stage and load the chapter
      window.resetStageShell();
      
      // Create ModularTrainingSystem with the chapter data and current progress
      new ModularTrainingSystem(
        chapter.data,
        0,  // idx not used in new system
        this.currentChapterKey,
        null,  // transcript
        chapter.progress.currentSegment  // start from saved progress
      );
    },
    
    // Post progress for current segment
    async postSegmentProgress(segmentNum, completed = false) {
      if (!this.accessToken || !this.currentChapterKey) {
        console.warn('⚠️ Cannot post progress: not authenticated or no current chapter');
        return;
      }
      
      const chapter = this.allChapters[this.currentChapterKey];
      if (!chapter) return;
      
      // Update local progress
      chapter.progress.currentSegment = segmentNum;
      chapter.progress.completed = completed;
      chapter.progress.lastUpdated = new Date().toISOString();
      
      // Build modules data for API
      const modulesData = {};
      
      for (const key in this.allChapters) {
        const { module, chapter: chapNum } = this.parseChapterKey(key);
        const prog = this.allChapters[key].progress;
        
        if (!modulesData[module]) {
          modulesData[module] = { chapters: {} };
        }
        
        modulesData[module].chapters[chapNum] = {
          currentSegment: prog.currentSegment,
          totalSegments: prog.totalSegments,
          completed: prog.completed,
          lastUpdated: prog.lastUpdated
        };
      }
      
      try {
        const payload = {
          training_progress: {
            modules: modulesData,
            last_updated: new Date().toISOString()
          }
        };
        
        console.log(`📤 Posting progress: ${this.currentChapterKey} segment ${segmentNum}`);
        
        const response = await this.fetchWithAuth(`${API_BASE}/api/training-progress`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
          throw new Error(`${response.status}: ${response.statusText}`);
        }
        
        const data = await response.json();
        console.log('✅ Progress saved:', data);
        
        // Update progress display
        this.updateProgressDisplay(data.training_progress);
        
        // If chapter completed, move to next chapter
        if (completed) {
          console.log(`🎉 Chapter ${this.currentChapterKey} completed!`);
          this.moveToNextChapter();
        }
        
      } catch (e) {
        console.error('❌ Failed to post progress:', e.message);
      }
    },
    
    // Move to next chapter
    moveToNextChapter() {
      const currentIndex = this.CHAPTER_FILES.indexOf(`${this.currentChapterKey}.json`);
      
      if (currentIndex >= 0 && currentIndex < this.CHAPTER_FILES.length - 1) {
        const nextFilename = this.CHAPTER_FILES[currentIndex + 1];
        const nextKey = nextFilename.replace('.json', '');
        
        console.log(`➡️ Moving to next chapter: ${nextKey}`);
        this.currentChapterKey = nextKey;
        this.loadCurrentChapter();
      } else {
        console.log('🎓 All chapters completed!');
        document.getElementById('moduleTitle').textContent = 'All chapters completed! 🎉';
      }
    },
    
    // Update progress display panel
    updateProgressDisplay(trainingProgress) {
      console.log('\n📊 ===== UPDATE PROGRESS DISPLAY =====');
      console.log('trainingProgress parameter:', trainingProgress);
      console.log('this.allChapters:', this.allChapters);
      console.log('Number of chapters loaded:', Object.keys(this.allChapters).length);
      
      const modules = (trainingProgress && trainingProgress.modules) || {};
      const lastUpdated = trainingProgress && trainingProgress.last_updated;
      
      // Calculate BOTH segment-based AND time-based progress
      let totalSegments = 0;
      let completedSegments = 0;
      let totalSeconds = 0;
      let completedSeconds = 0;
      
      console.log('\n📈 Calculating overall progress:');
      
      // Build debug information
      let debugLines = [];
      debugLines.push(`Loaded Chapters: ${Object.keys(this.allChapters).length}`);
      debugLines.push(`Server Progress Available: ${!!trainingProgress}`);
      debugLines.push(`Using SEGMENT_TIMINGS: ${!!window.SEGMENT_TIMINGS}`);
      debugLines.push('');
      
      for (const key in this.allChapters) {
        const chapter = this.allChapters[key];
        const progress = chapter.progress || {};
        const current = progress.currentSegment || 0;
        const total = progress.totalSegments || 0;
        
        // Get timing data
        const chapterDuration = this.getChapterDuration(key);
        const segmentDurations = window.SEGMENT_TIMINGS && window.SEGMENT_TIMINGS[key] 
          ? window.SEGMENT_TIMINGS[key].durations 
          : [];
        
        // Calculate completed time for this chapter
        let chapterCompletedTime = 0;
        if (segmentDurations.length > 0) {
          for (let i = 0; i < current && i < segmentDurations.length; i++) {
            chapterCompletedTime += segmentDurations[i];
          }
        }
        
        totalSeconds += chapterDuration;
        completedSeconds += chapterCompletedTime;
        
        console.log(`  ${key}: ${current}/${total} segments (${chapterCompletedTime}/${chapterDuration}s) ${progress.completed ? '✓' : ''}`);
        debugLines.push(`${key}: ${current}/${total} segments, ${chapterCompletedTime}/${chapterDuration}s`);
        
        totalSegments += total;
        completedSegments += current;
      }
      
      debugLines.push('');
      debugLines.push(`Segment Total: ${completedSegments}/${totalSegments}`);
      debugLines.push(`Time Total: ${completedSeconds}/${totalSeconds}s`);
      
      console.log(`\n✅ TOTALS: ${completedSegments}/${totalSegments} segments`);
      console.log(`⏱️ TIME TOTALS: ${completedSeconds}/${totalSeconds} seconds`);
      
      // Use time-based progress as primary if available, fallback to segment-based
      const overallPercent = totalSeconds > 0
        ? Math.round((completedSeconds / totalSeconds) * 100)
        : totalSegments > 0
          ? Math.round((completedSegments / totalSegments) * 100)
          : 0;
      
      console.log(`📊 Overall Percentage: ${overallPercent}% (${totalSeconds > 0 ? 'time-based' : 'segment-based'})`);
      
      // Update overall progress elements
      const overallPercentEl = document.getElementById('overallPercent');
      const segmentCountEl = document.getElementById('segmentCount');
      const overallBarEl = document.getElementById('overallBar');
      const lastUpdatedEl = document.getElementById('lastUpdated');
      const debugInfoEl = document.getElementById('debugInfo');
      const debugTextEl = document.getElementById('debugText');
      
      if (overallPercentEl) {
        overallPercentEl.textContent = overallPercent;
        console.log(`✅ Set overallPercent to: ${overallPercent}%`);
      } else {
        console.error('❌ overallPercent element NOT FOUND');
      }
      
      if (segmentCountEl) {
        // Show time if available, otherwise segments
        if (totalSeconds > 0) {
          const completedMin = Math.floor(completedSeconds / 60);
          const completedSec = completedSeconds % 60;
          const totalMin = Math.floor(totalSeconds / 60);
          const totalSec = totalSeconds % 60;
          segmentCountEl.textContent = `${completedMin}:${completedSec.toString().padStart(2,'0')} / ${totalMin}:${totalSec.toString().padStart(2,'0')} completed`;
        } else {
          segmentCountEl.textContent = `${completedSegments}/${totalSegments} segments completed`;
        }
        console.log(`✅ Set segmentCount to: ${segmentCountEl.textContent}`);
      }
      
      if (overallBarEl) {
        overallBarEl.style.width = `${overallPercent}%`;
        console.log(`✅ Set progress bar width to: ${overallPercent}%`);
      }
      
      if (lastUpdated && lastUpdatedEl) {
        const date = new Date(lastUpdated);
        lastUpdatedEl.textContent = 
          `Synced ${date.toLocaleDateString()} at ${date.toLocaleTimeString()}`;
        console.log(`✅ Set lastUpdated timestamp`);
      } else if (lastUpdatedEl) {
        lastUpdatedEl.textContent = 'Not synced with server';
      }
      
      // Show debug info if progress is 0 or seems wrong
      if (debugInfoEl && debugTextEl && (totalSegments === 0 || (overallPercent === 0 && Object.keys(this.allChapters).length > 0))) {
        debugInfoEl.style.display = 'block';
        debugTextEl.textContent = debugLines.join('\n');
        console.log('⚠️ Showing debug info because progress looks wrong');
      } else if (debugInfoEl) {
        debugInfoEl.style.display = 'none';
      }
      
      console.log('\n📊 Module-by-module breakdown:');
      
      // Update module progress list
      const moduleList = document.getElementById('moduleProgressList');
      if (!moduleList) {
        console.error('❌ moduleProgressList element NOT FOUND');
        return;
      }
      
      moduleList.innerHTML = '';
      
      // Group chapters by module
      const moduleGroups = {};
      for (const key in this.allChapters) {
        const parsed = this.parseChapterKey(key);
        if (!parsed) continue;
        
        const { module } = parsed;
        if (!moduleGroups[module]) {
          moduleGroups[module] = [];
        }
        moduleGroups[module].push(key);
      }
      
      // Display each module with expandable chapter details
      for (let modNum = 1; modNum <= 6; modNum++) {
        const chapters = moduleGroups[modNum] || [];
        
        if (chapters.length === 0) {
          console.log(`  Module ${modNum}: No chapters loaded`);
          continue;
        }
        
        console.log(`\n  Module ${modNum}: ${chapters.length} chapters`);
        
        let modTotalSegments = 0;
        let modCompletedSegments = 0;
        let modTotalSeconds = 0;
        let modCompletedSeconds = 0;
        let chapterDetailsHTML = '';
        
        chapters.sort((a, b) => {
          const aNum = parseInt(a.split('-')[1]);
          const bNum = parseInt(b.split('-')[1]);
          return aNum - bNum;
        });
        
        chapters.forEach(key => {
          const chapter = this.allChapters[key];
          if (chapter) {
            const progress = chapter.progress || {};
            const current = progress.currentSegment || 0;
            const total = progress.totalSegments || 0;
            
            // Get timing data for this chapter
            const chapterDuration = this.getChapterDuration(key);
            const segmentDurations = window.SEGMENT_TIMINGS && window.SEGMENT_TIMINGS[key] 
              ? window.SEGMENT_TIMINGS[key].durations 
              : [];
            
            let chapterCompletedTime = 0;
            if (segmentDurations.length > 0) {
              for (let i = 0; i < current && i < segmentDurations.length; i++) {
                chapterCompletedTime += segmentDurations[i];
              }
            }
            
            // Use time-based percentage if available
            const percent = chapterDuration > 0
              ? Math.round((chapterCompletedTime / chapterDuration) * 100)
              : total > 0
                ? Math.round((current / total) * 100)
                : 0;
            
            console.log(`    ${key}: ${current}/${total} (${percent}%) - ${chapterCompletedTime}/${chapterDuration}s`);
            
            modTotalSegments += total;
            modCompletedSegments += current;
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
                refreshBtn.textContent = '🔄';
                refreshBtn.disabled = false;
                
                // Show brief success feedback
                refreshBtn.textContent = '✓';
                setTimeout(() => {
                  refreshBtn.textContent = '🔄';
                }, 1000);
              }).catch(() => {
                refreshBtn.textContent = '✗';
                setTimeout(() => {
                  refreshBtn.textContent = '🔄';
                  refreshBtn.disabled = false;
                }, 2000);
              });
            } else {
              alert('Not authenticated. Please authenticate to sync progress.');
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
