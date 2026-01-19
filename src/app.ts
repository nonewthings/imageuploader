import { Provider, UploadResult, ALLOWED_EXTENSIONS } from './types';

declare const API_BASE_URL: string;

interface ExtendedFile extends Omit<File, 'webkitRelativePath'> {
  webkitRelativePath?: string;
  mozRelativePath?: string;
  path?: string;
}

interface RateLimitState {
  limit: number;
  remaining: number;
  reset: number;
  bucket: string | null;
}

class ImageUploader {
  private files: File[] = [];
  private provider: Provider;
  private uploadCompleted = false;
  private apiBaseUrl: string;

  private form!: HTMLFormElement;
  private providerSelect!: HTMLSelectElement;
  private filesInput!: HTMLInputElement;
  private dropZone!: HTMLElement;
  private fileList!: HTMLElement;
  private urlGroup!: HTMLElement;
  private createCollectionGroup!: HTMLElement;
  private sxcuOptions!: HTMLElement;
  private anonymousGroup!: HTMLElement;
  private postIdGroup!: HTMLElement;
  private uploadBtn!: HTMLButtonElement;
  private resultsDiv!: HTMLElement;
  private resultsContent!: HTMLElement;
  private progressDiv!: HTMLElement;
  private progressFill!: HTMLElement;
  private progressText!: HTMLElement;
  private urlsInput!: HTMLInputElement;
  private titleInput!: HTMLInputElement;
  private postIdInput!: HTMLInputElement;
  private fileTypesHint!: HTMLElement;
  private imgchestApiKeyGroup!: HTMLElement;
  private imgchestApiKeyInput!: HTMLInputElement;
  private toggleApiKeyBtn!: HTMLButtonElement;

  constructor() {
    this.provider = (localStorage.getItem('image_uploader_provider') as Provider) || 'imgchest';
    this.apiBaseUrl = typeof API_BASE_URL !== 'undefined' ? API_BASE_URL : '';
    this.init();
  }

  private init(): void {
    this.form = document.getElementById('uploadForm') as HTMLFormElement;
    this.providerSelect = document.getElementById('provider') as unknown as HTMLSelectElement;
    this.filesInput = document.getElementById('files') as HTMLInputElement;
    this.dropZone = document.getElementById('dropZone') as HTMLElement;
    this.fileList = document.getElementById('fileList') as HTMLElement;
    this.urlGroup = document.getElementById('urlGroup') as HTMLElement;
    this.createCollectionGroup = document.getElementById('createCollectionGroup') as HTMLElement;
    this.sxcuOptions = document.getElementById('sxcuOptions') as HTMLElement;
    this.anonymousGroup = document.getElementById('anonymousGroup') as HTMLElement;
    this.postIdGroup = document.getElementById('postIdGroup') as HTMLElement;
    this.uploadBtn = document.getElementById('uploadBtn') as HTMLButtonElement;
    this.resultsDiv = document.getElementById('results') as HTMLElement;
    this.resultsContent = document.getElementById('resultsContent') as HTMLElement;
    this.progressDiv = document.getElementById('progress') as HTMLElement;
    this.progressFill = document.getElementById('progressFill') as HTMLElement;
    this.progressText = document.getElementById('progressText') as HTMLElement;
    this.urlsInput = document.getElementById('urls') as HTMLInputElement;
    this.titleInput = document.getElementById('title') as HTMLInputElement;
    this.postIdInput = document.getElementById('postId') as HTMLInputElement;
    this.fileTypesHint = document.getElementById('fileTypesHint') as HTMLElement;
    this.imgchestApiKeyGroup = document.getElementById('imgchestApiKeyGroup') as HTMLElement;
    this.imgchestApiKeyInput = document.getElementById('imgchestApiKey') as HTMLInputElement;
    this.toggleApiKeyBtn = document.getElementById('toggleApiKeyVisibility') as HTMLButtonElement;

    this.providerSelect.value = this.provider;

    const savedApiKey = localStorage.getItem('imgchest_api_key');
    if (savedApiKey && this.imgchestApiKeyInput) {
      this.imgchestApiKeyInput.value = savedApiKey;
    }

    this.bindEvents();
    this.updateUI();
  }

  private bindEvents(): void {
    this.form.addEventListener('submit', (e) => this.handleSubmit(e));

    this.providerSelect.addEventListener('change', () => {
      this.provider = this.providerSelect.value as Provider;
      localStorage.setItem('image_uploader_provider', this.provider);
      this.updateUI();
    });

    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    if (anonymousCheckbox) {
      anonymousCheckbox.addEventListener('change', () => {
        this.updateAnonymousWarning();
        this.updatePostIdVisibility();
      });
    }

    const createCollectionCheckbox = document.getElementById('createCollection') as HTMLInputElement;
    if (createCollectionCheckbox) {
      createCollectionCheckbox.addEventListener('change', () => {
        if (this.sxcuOptions) {
          this.sxcuOptions.classList.toggle('hidden', !createCollectionCheckbox.checked);
        }
      });
    }

    if (this.imgchestApiKeyInput) {
      this.imgchestApiKeyInput.addEventListener('change', () => {
        const value = this.imgchestApiKeyInput.value.trim();
        if (value) {
          localStorage.setItem('imgchest_api_key', value);
        } else {
          localStorage.removeItem('imgchest_api_key');
        }
      });
    }

    if (this.toggleApiKeyBtn) {
      this.toggleApiKeyBtn.addEventListener('click', () => {
        if (this.imgchestApiKeyInput.type === 'password') {
          this.imgchestApiKeyInput.type = 'text';
          this.toggleApiKeyBtn.textContent = '🙈';
        } else {
          this.imgchestApiKeyInput.type = 'password';
          this.toggleApiKeyBtn.textContent = '👁';
        }
      });
    }

    this.filesInput.addEventListener('change', (e) => {
      if (this.uploadCompleted) {
        this.files = [];
        this.fileList.innerHTML = '';
        this.titleInput.value = '';
        this.postIdInput.value = '';
        this.urlsInput.value = '';
        this.resultsDiv.style.display = 'none';
        this.uploadCompleted = false;
      }

      const input = e.target as HTMLInputElement;
      const fileList = input.files;
      if (fileList && fileList.length > 0) {
        for (let i = 0; i < fileList.length; i++) {
          const file = fileList[i];
          const ext = '.' + file.name.split('.').pop()?.toLowerCase();
          if (ALLOWED_EXTENSIONS.includes(ext)) {
            const exists = this.files.some(f => f.name === file.name && f.size === file.size);
            if (!exists) {
              this.files.push(file);
            }
          }
        }

        this.renderFileList();
        this.updateAnonymousWarning();

        if (this.files.length > 0 && !this.titleInput.value) {
          const firstFile = this.files[0] as ExtendedFile;
          const path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.name;
          const lastSlash = path.lastIndexOf('/');
          if (lastSlash > 0) {
            const folderName = path.substring(0, lastSlash).split('/').pop();
            this.titleInput.value = folderName || '';
          } else {
            this.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
          }
        }
      }

      this.filesInput.value = '';
    });

    this.dropZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.dropZone.classList.add('dragover');
    });

    this.dropZone.addEventListener('dragleave', () => {
      this.dropZone.classList.remove('dragover');
    });

    this.dropZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.dropZone.classList.remove('dragover');
      if (e.dataTransfer?.files) {
        this.addFiles(e.dataTransfer.files);
      }
    });

    this.dropZone.addEventListener('click', (e) => {
      if (e.target !== this.filesInput) {
        this.filesInput.click();
      }
    });
  }

  private updateAnonymousWarning(): void {
    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    const existingWarning = this.fileList.parentNode?.querySelector('.anonymous-limit-warning');
    const isImgchest = this.provider === 'imgchest';

    if (isImgchest && anonymousCheckbox?.checked && this.files.length > 20) {
      if (!existingWarning) {
        const warning = document.createElement('div');
        warning.className = 'anonymous-limit-warning';
        warning.textContent = '⚠ Anonymous posts are limited to 20 images. Only the first 20 files will be uploaded.';
        this.fileList.parentNode?.insertBefore(warning, this.fileList.nextSibling);
      }
    } else {
      existingWarning?.remove();
    }
  }

  private updatePostIdVisibility(): void {
    const anonymousCheckbox = document.getElementById('anonymous') as HTMLInputElement;
    const isImgchest = this.provider === 'imgchest';

    if (this.postIdGroup) {
      const shouldHide = !isImgchest || anonymousCheckbox?.checked;
      this.postIdGroup.classList.toggle('hidden', shouldHide);
    }
  }

  private updateUI(): void {
    const isSxcu = this.provider === 'sxcu';
    const isImgchest = this.provider === 'imgchest';
    const isCatbox = this.provider === 'catbox';

    this.urlGroup.classList.toggle('hidden', isSxcu || isImgchest);
    this.createCollectionGroup.classList.toggle('hidden', !isSxcu);

    if (this.sxcuOptions) {
      const createCollectionCheckbox = document.getElementById('createCollection') as HTMLInputElement;
      this.sxcuOptions.classList.toggle('hidden', !isSxcu || !createCollectionCheckbox?.checked);
    }

    this.anonymousGroup.classList.toggle('hidden', !isImgchest);
    if (this.imgchestApiKeyGroup) {
      this.imgchestApiKeyGroup.classList.toggle('hidden', !isImgchest);
    }
    this.updatePostIdVisibility();
    this.updateAnonymousWarning();

    const createAlbumGroup = document.getElementById('createAlbumGroup');
    if (createAlbumGroup) {
      createAlbumGroup.classList.toggle('hidden', !isCatbox);
    }

    this.filesInput.setAttribute('accept', ALLOWED_EXTENSIONS.join(','));

    if (this.fileTypesHint) {
      if (isCatbox) {
        this.fileTypesHint.textContent = 'Blocked: EXE, SCR, CPL, DOC*, JAR';
      } else if (isSxcu) {
        this.fileTypesHint.textContent = 'Allowed: PNG, GIF, JPEG, ICO, BMP, TIFF, WEBM, WEBP';
      } else {
        this.fileTypesHint.textContent = 'Allowed: JPG, JPEG, PNG, GIF, WEBP';
      }
    }
  }

  private addFiles(fileList: FileList): void {
    for (let i = 0; i < fileList.length; i++) {
      const file = fileList[i];
      const ext = '.' + file.name.split('.').pop()?.toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) {
        const exists = this.files.some(f => f.name === file.name && f.size === file.size);
        if (!exists) {
          this.files.push(file);
        }
      }
    }

    this.renderFileList();
    this.updateAnonymousWarning();

    if (this.files.length > 0 && !this.titleInput.value) {
      const firstFile = this.files[0] as ExtendedFile;
      const path = firstFile.webkitRelativePath || firstFile.mozRelativePath || firstFile.name;
      const lastSlash = path.lastIndexOf('/');
      if (lastSlash > 0) {
        const folderName = path.substring(0, lastSlash).split('/').pop();
        this.titleInput.value = folderName || '';
      } else {
        this.titleInput.value = firstFile.name.replace(/\.[^/.]+$/, '');
      }
    }
  }

  private removeFile(index: number): void {
    this.files.splice(index, 1);
    this.renderFileList();
  }

  private renderFileList(): void {
    this.fileList.innerHTML = '';
    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      const item = document.createElement('div');
      item.className = 'file-item';
      item.innerHTML = `<span class="file-name">${file.name} (${this.formatSize(file.size)})</span><button type="button" class="remove-btn" data-index="${i}">&times;</button>`;
      const removeBtn = item.querySelector('.remove-btn') as HTMLButtonElement;
      const idx = i;
      removeBtn.onclick = () => this.removeFile(idx);
      this.fileList.appendChild(item);
    }
  }

  private formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  private handleSubmit(e: Event): void {
    e.preventDefault();

    if (this.files.length === 0 && !this.urlsInput.value.trim()) {
      this.showError('Please select at least one file or enter URLs');
      return;
    }

    this.setLoading(true);
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '<div class="summary warning">Uploading...</div>';
    this.progressDiv.style.display = 'block';
    this.progressFill.style.width = '0%';

    const results: UploadResult[] = [];
    const urls = this.urlsInput.value.trim()
      ? this.urlsInput.value.split(',').map(u => u.trim())
      : [];

    try {
      switch (this.provider) {
        case 'catbox':
          this.uploadToCatbox(results, urls);
          break;
        case 'sxcu':
          this.uploadToSxcu(results);
          break;
        case 'imgchest':
          this.uploadToImgchest(results);
          break;
      }
    } catch (error) {
      this.showError((error as Error).message);
    } finally {
      this.setLoading(false);
      this.progressDiv.style.display = 'none';
    }
  }

  private uploadToCatbox(results: UploadResult[], urls: string[]): void {
    const title = this.titleInput.value;
    const description = (document.getElementById('description') as HTMLInputElement).value;
    const totalItems = this.files.length + urls.length;
    let completedItems = 0;

    const uploadFile = (file: File, callback: () => void): void => {
      this.updateProgress((completedItems / totalItems) * 100, 'Uploading ' + file.name + '...');

      const formData = new FormData();
      formData.append('reqtype', 'fileupload');
      formData.append('fileToUpload', file);

      fetch(this.apiBaseUrl + '/upload/catbox', { method: 'POST', body: formData })
        .then(response => {
          if (!response.ok) throw new Error('Upload failed: ' + response.statusText);
          return response.text();
        })
        .then(url => {
          const result: UploadResult = { type: 'success', url: url.trim() };
          results.push(result);
          this.addIncrementalResult(result, results.length - 1);
          completedItems++;
          callback();
        })
        .catch(error => {
          const result: UploadResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message };
          results.push(result);
          this.addIncrementalResult(result, results.length - 1);
          completedItems++;
          callback();
        });
    };

    const uploadUrl = (url: string, callback: () => void): void => {
      this.updateProgress(((this.files.length + completedItems) / totalItems) * 100, 'Uploading ' + url + '...');

      const formData = new FormData();
      formData.append('reqtype', 'urlupload');
      formData.append('url', url);

      fetch(this.apiBaseUrl + '/upload/catbox', { method: 'POST', body: formData })
        .then(response => {
          if (!response.ok) throw new Error('URL upload failed: ' + response.statusText);
          return response.text();
        })
        .then(uploadedUrl => {
          const result: UploadResult = { type: 'success', url: uploadedUrl.trim() };
          results.push(result);
          this.addIncrementalResult(result, results.length - 1);
          completedItems++;
          callback();
        })
        .catch(error => {
          const result: UploadResult = { type: 'error', message: 'Failed to upload ' + url + ': ' + error.message };
          results.push(result);
          this.addIncrementalResult(result, results.length - 1);
          completedItems++;
          callback();
        });
    };

    const createAlbum = (): void => {
      this.updateProgress(95, 'Creating album...');

      const uploadedUrls = results.filter(r => r.type === 'success').map(r => r.url!);

      if (uploadedUrls.length > 0) {
        const fileNames = uploadedUrls.map(url => {
          try {
            const uri = new URL(url);
            return uri.pathname.split('/').pop() || url;
          } catch {
            return url;
          }
        });

        const albumFormData = new FormData();
        albumFormData.append('reqtype', 'createalbum');
        albumFormData.append('title', title);
        albumFormData.append('desc', description);
        albumFormData.append('files', fileNames.join(' '));

        fetch(this.apiBaseUrl + '/upload/catbox', { method: 'POST', body: albumFormData })
          .then(response => {
            if (response.ok) return response.text();
            throw new Error('Album creation failed');
          })
          .then(albumCode => {
            const albumUrl = albumCode.indexOf('http') === 0 ? albumCode : 'https://catbox.moe/album/' + albumCode;
            const albumResult: UploadResult = { type: 'success', url: albumUrl, isAlbum: true };
            results.push(albumResult);
            this.addIncrementalResult(albumResult, results.length - 1);
            this.updateProgress(100, 'Done!');
            this.displayResults(results, totalItems);
          })
          .catch(error => {
            const errorResult: UploadResult = { type: 'error', message: 'Failed to create album: ' + error.message };
            results.push(errorResult);
            this.addIncrementalResult(errorResult, results.length - 1);
            this.updateProgress(100, 'Done!');
            this.displayResults(results, totalItems);
          });
      } else {
        this.updateProgress(100, 'Done!');
        this.displayResults(results, totalItems);
      }
    };

    const shouldCreateAlbum = (document.getElementById('createAlbum') as HTMLInputElement).checked;

    const processNext = (): void => {
      if (completedItems >= this.files.length + urls.length) {
        if (shouldCreateAlbum) {
          createAlbum();
        } else {
          this.updateProgress(100, 'Done!');
          this.displayResults(results, totalItems);
        }
        return;
      }

      if (completedItems < this.files.length) {
        uploadFile(this.files[completedItems], processNext);
      } else {
        uploadUrl(urls[completedItems - this.files.length], processNext);
      }
    };

    processNext();
  }

  private uploadToSxcu(results: UploadResult[]): void {
    const createCollection = (document.getElementById('createCollection') as HTMLInputElement).checked;
    const isPrivate = (document.getElementById('sxcuPrivate') as HTMLInputElement).checked;
    const title = this.titleInput.value;
    const description = (document.getElementById('description') as HTMLInputElement).value;
    let collectionId = '';
    let collectionToken = '';
    const totalFiles = this.files.length;
    let completedFiles = 0;
    let filesToUpload = [...Array(totalFiles).keys()];

    const rateLimitState: RateLimitState = {
      limit: 5,
      remaining: 5,
      reset: 0,
      bucket: null
    };

    const parseRateLimitHeaders = (headers: Headers): RateLimitState => ({
      limit: parseInt(headers.get('X-RateLimit-Limit') || '5') || 5,
      remaining: parseInt(headers.get('X-RateLimit-Remaining') || '0') || 0,
      reset: parseInt(headers.get('X-RateLimit-Reset') || '0') || 0,
      bucket: headers.get('X-RateLimit-Bucket') || null
    });

    const getWaitSeconds = (): number => {
      if (rateLimitState.reset <= 0) return 60;
      const now = Math.floor(Date.now() / 1000);
      const wait = rateLimitState.reset - now + 1;
      return wait > 0 ? wait : 1;
    };

    const uploadFile = (fileIndex: number, callback: (err: Error | null, success: boolean) => void): void => {
      const file = this.files[fileIndex];
      this.updateProgress((completedFiles / totalFiles) * 100, 'Uploading ' + file.name + '...');

      const formData = new FormData();
      formData.append('file', file);
      formData.append('noembed', 'true');

      if (collectionId) formData.append('collection', collectionId);
      if (collectionToken) formData.append('collection_token', collectionToken);

      fetch(this.apiBaseUrl + '/upload/sxcu/files', {
        method: 'POST',
        body: formData,
        headers: { 'User-Agent': 'sxcuUploader/1.0' }
      })
        .then(response => {
          const newRateLimit = parseRateLimitHeaders(response.headers);
          rateLimitState.limit = newRateLimit.limit;
          rateLimitState.remaining = newRateLimit.remaining;
          if (newRateLimit.reset > 0) rateLimitState.reset = newRateLimit.reset;
          if (newRateLimit.bucket) rateLimitState.bucket = newRateLimit.bucket;

          return response.json().then((rawData: unknown) => {
            const data = rawData as { url?: string; error?: { message?: string } | string; message?: string; rateLimitReset?: string; rateLimitResetAfter?: string };
            if (response.status === 429) {
              if (data.rateLimitReset) {
                rateLimitState.reset = parseInt(data.rateLimitReset);
              } else if (data.rateLimitResetAfter) {
                rateLimitState.reset = Math.floor(Date.now() / 1000) + parseFloat(data.rateLimitResetAfter);
              }
              throw new Error('Rate limit exceeded');
            }

            if (!response.ok) {
              let msg = data.message || (typeof data.error === 'object' ? data.error?.message : data.error) || response.statusText;
              if (typeof msg === 'object') msg = JSON.stringify(msg);
              throw new Error('Upload failed: ' + msg);
            }
            return data;
          });
        })
        .then(data => {
          results.push({ type: 'success', url: data.url });
          completedFiles++;
          callback(null, true);
        })
        .catch(error => {
          callback(error, false);
        });
    };

    const processNextBurst = (): void => {
      if (filesToUpload.length === 0) {
        this.updateProgress(100, 'Done!');
        this.displayResults(results, totalFiles);
        return;
      }

      let burstSize = Math.min(4, filesToUpload.length);
      const currentRemaining = rateLimitState.remaining;

      if (currentRemaining < burstSize && currentRemaining > 0) {
        burstSize = currentRemaining;
      }

      const indicesToUpload = filesToUpload.slice(0, burstSize);
      let rateLimited = false;
      let uploadedCount = 0;
      let burstProcessedCount = 0;

      const uploadNext = (idx: number): void => {
        if (idx >= indicesToUpload.length) {
          if (rateLimited) {
            if (burstProcessedCount > 0) {
              filesToUpload = filesToUpload.slice(burstProcessedCount);
            }
            let waitSeconds = getWaitSeconds();

            const updateCountdown = () => {
              if (waitSeconds <= 0) {
                const rateLimitNotice = this.resultsContent.querySelector('#rate-limit-notice');
                if (rateLimitNotice) rateLimitNotice.remove();
                processNextBurst();
                return;
              }

              const msg = 'Rate limited. Waiting ' + waitSeconds + 's...';
              this.updateProgress((completedFiles / totalFiles) * 100, msg);

              const rateLimitNotice = this.resultsContent.querySelector('#rate-limit-notice');
              if (rateLimitNotice) {
                rateLimitNotice.textContent = 'Rate limited! Waiting ' + waitSeconds + 's before next upload...';
              }

              waitSeconds--;
              setTimeout(updateCountdown, 1000);
            };

            updateCountdown();
          } else {
            const rateLimitNotice = this.resultsContent.querySelector('#rate-limit-notice');
            if (rateLimitNotice) rateLimitNotice.remove();
            filesToUpload = filesToUpload.slice(burstSize);
            if (filesToUpload.length > 0) {
              setTimeout(processNextBurst, 200);
            } else {
              this.updateProgress(100, 'Done!');
              this.displayResults(results, totalFiles);
            }
          }
          return;
        }

        const fileIndex = indicesToUpload[idx];
        const file = this.files[fileIndex];
        this.updateProgress(((completedFiles + idx) / totalFiles) * 100, 'Uploading ' + file.name + '...');

        uploadFile(fileIndex, (err, success) => {
          if (success) {
            uploadedCount++;
            burstProcessedCount = idx + 1;
            const lastResult = results[results.length - 1];
            if (lastResult?.type === 'success') {
              this.addIncrementalResult(lastResult, results.length - 1);
            }
            this.updateProgress(((completedFiles + uploadedCount + (indicesToUpload.length - idx - 1)) / totalFiles) * 100, 'Uploaded: ' + lastResult?.url);
          } else if (err && (err.message.includes('Rate limit') || err.message.includes('429') || err.message.includes('Too Many Requests'))) {
            rateLimited = true;
            const waitSeconds = getWaitSeconds();
            const rateLimitNotice = document.createElement('div');
            rateLimitNotice.className = 'result-item warning';
            rateLimitNotice.textContent = 'Rate limited! Waiting ' + waitSeconds + 's before next upload...';
            rateLimitNotice.id = 'rate-limit-notice';
            const existingNotice = this.resultsContent.querySelector('#rate-limit-notice');
            if (existingNotice) existingNotice.remove();
            this.resultsContent.insertBefore(rateLimitNotice, this.resultsContent.firstChild);
            rateLimitNotice.scrollIntoView({ behavior: 'smooth', block: 'center' });

            uploadNext(indicesToUpload.length);
            return;
          } else {
            burstProcessedCount = idx + 1;
          }
          uploadNext(idx + 1);
        });
      };

      this.updateProgress((completedFiles / totalFiles) * 100, 'Uploading ' + (completedFiles + 1) + '-' + (completedFiles + indicesToUpload.length) + ' of ' + totalFiles + '...');
      uploadNext(0);
    };

    if (createCollection) {
      this.updateProgress(0, 'Creating collection...');

      const formData = new FormData();
      formData.append('title', title || 'Untitled');
      formData.append('desc', description);
      formData.append('private', isPrivate ? 'true' : 'false');

      fetch(this.apiBaseUrl + '/upload/sxcu/collections', {
        method: 'POST',
        body: formData,
        headers: { 'User-Agent': 'sxcuUploader/1.0' }
      })
        .then(response => {
          if (!response.ok) throw new Error('Collection creation failed: ' + response.statusText);
          return response.json();
        })
        .then((rawData: unknown) => {
          const data = rawData as { collection_id?: string; id?: string; collection_token?: string; token?: string };
          collectionId = data.collection_id || data.id || '';
          collectionToken = data.collection_token || data.token || '';

          if (!collectionId && !collectionToken) {
            throw new Error('Invalid collection response. Keys: ' + Object.keys(data).join(', '));
          }

          const collectionResult: UploadResult = { type: 'success', url: 'https://sxcu.net/c/' + collectionId, isCollection: true };
          results.push(collectionResult);
          this.addIncrementalResult(collectionResult, results.length - 1);
          this.updateProgress(0, 'Collection created. Starting uploads...');
          processNextBurst();
        })
        .catch(error => {
          results.push({ type: 'error', message: 'Failed to create collection: ' + error.message });
          this.updateProgress(100, 'Done!');
          this.displayResults(results, totalFiles);
        });
    } else {
      processNextBurst();
    }
  }

  private uploadToImgchest(results: UploadResult[]): void {
    const anonymous = (document.getElementById('anonymous') as HTMLInputElement).checked;
    const postId = this.postIdInput.value.trim();
    const title = this.titleInput.value;

    if (postId && anonymous) {
      this.showError('Cannot add images to anonymous posts. Anonymous posts do not support adding images after creation.');
      this.setLoading(false);
      this.progressDiv.style.display = 'none';
      return;
    }

    const totalFiles = this.files.length;
    let filesToUpload = this.files.slice();

    if (anonymous) {
      filesToUpload = filesToUpload.slice(0, 20);
    }

    if (anonymous) {
      this.uploadImgchestBatch(postId, filesToUpload, results, totalFiles, anonymous);
    } else if (postId) {
      this.uploadImgchestProgressiveAddToPost(postId, filesToUpload, results, totalFiles);
    } else {
      this.uploadImgchestProgressive(filesToUpload, results, totalFiles, title);
    }
  }

  private uploadImgchestBatch(postId: string, files: File[], results: UploadResult[], totalFiles: number, anonymous: boolean): void {
    const title = this.titleInput.value;

    this.updateProgress(0, postId ? 'Adding images...' : 'Creating post...');

    const formData = new FormData();
    if (title) formData.append('title', title);
    formData.append('privacy', 'hidden');
    formData.append('nsfw', 'true');
    if (anonymous) formData.append('anonymous', '1');

    for (const file of files) {
      formData.append('images[]', file);
    }

    const url = postId
      ? this.apiBaseUrl + '/upload/imgchest/post/' + postId + '/add'
      : this.apiBaseUrl + '/upload/imgchest/post';

    const fetchOptions: RequestInit = { method: 'POST', body: formData };

    const customToken = this.imgchestApiKeyInput?.value.trim();
    if (customToken) {
      fetchOptions.headers = { 'Authorization': 'Bearer ' + customToken };
    }

    fetch(url, fetchOptions)
      .then(response => response.text())
      .then(text => {
        try {
          const data = JSON.parse(text);
          if (data.error) {
            let errorMsg = data.error;
            if (data.details) {
              errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
            }
            throw new Error(errorMsg);
          }

          const postResult: UploadResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
          results.push(postResult);
          this.addIncrementalResult(postResult, results.length - 1);

          let newImages: Array<{ link: string }>;
          if (postId) {
            const existingCount = data.data.image_count - files.length;
            newImages = data.data.images.slice(existingCount);
          } else {
            newImages = data.data.images;
          }

          for (const img of newImages) {
            const imgResult: UploadResult = { type: 'success', url: img.link };
            results.push(imgResult);
            this.addIncrementalResult(imgResult, results.length - 1);
          }

          this.updateProgress(100, 'Done!');
          this.displayResults(results, totalFiles);
        } catch (e) {
          results.push({ type: 'error', message: 'Failed to upload: ' + (e as Error).message });
          this.updateProgress(100, 'Done!');
          this.displayResults(results, totalFiles);
        }
      })
      .catch(error => {
        results.push({ type: 'error', message: 'Failed to upload: ' + error.message });
        this.updateProgress(100, 'Done!');
        this.displayResults(results, totalFiles);
      });
  }

  private uploadImgchestProgressiveAddToPost(postId: string, files: File[], results: UploadResult[], totalFiles: number): void {
    let completedFiles = 0;
    let postResultAdded = false;

    const uploadNextFile = (index: number): void => {
      if (index >= files.length) {
        this.updateProgress(100, 'Done!');
        this.displayResults(results, totalFiles);
        return;
      }

      const file = files[index];
      this.updateProgress((index / files.length) * 100, 'Adding ' + file.name + ' to post...');

      const formData = new FormData();
      formData.append('images[]', file);

      const url = this.apiBaseUrl + '/upload/imgchest/post/' + postId + '/add';

      const fetchOptions: RequestInit = { method: 'POST', body: formData };

      const customToken = this.imgchestApiKeyInput?.value.trim();
      if (customToken) {
        fetchOptions.headers = { 'Authorization': 'Bearer ' + customToken };
      }

      fetch(url, fetchOptions)
        .then(response => response.text())
        .then(text => {
          try {
            const data = JSON.parse(text);
            if (data.error) {
              let errorMsg = data.error;
              if (data.details) {
                errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
              }
              throw new Error(errorMsg);
            }

            if (!postResultAdded) {
              const postResult: UploadResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
              results.push(postResult);
              this.addIncrementalResult(postResult, results.length - 1);
              postResultAdded = true;
            }

            const newImages = data.data.images.slice(-1);
            for (const img of newImages) {
              const imgResult: UploadResult = { type: 'success', url: img.link };
              results.push(imgResult);
              this.addIncrementalResult(imgResult, results.length - 1);
            }

            completedFiles++;
            this.updateProgress((completedFiles / files.length) * 100, 'Added ' + completedFiles + ' of ' + files.length);
            uploadNextFile(index + 1);
          } catch (e) {
            const errResult: UploadResult = { type: 'error', message: 'Failed to add ' + file.name + ': ' + (e as Error).message };
            results.push(errResult);
            this.addIncrementalResult(errResult, results.length - 1);
            completedFiles++;
            uploadNextFile(index + 1);
          }
        })
        .catch(error => {
          const errResult: UploadResult = { type: 'error', message: 'Failed to add ' + file.name + ': ' + error.message };
          results.push(errResult);
          this.addIncrementalResult(errResult, results.length - 1);
          completedFiles++;
          uploadNextFile(index + 1);
        });
    };

    uploadNextFile(0);
  }

  private uploadImgchestProgressive(files: File[], results: UploadResult[], totalFiles: number, title: string): void {
    let currentPostId: string | null = null;
    let completedFiles = 0;

    const uploadNextFile = (index: number): void => {
      if (index >= files.length) {
        this.updateProgress(100, 'Done!');
        this.displayResults(results, totalFiles);
        return;
      }

      const file = files[index];
      const isFirst = index === 0;
      this.updateProgress((index / files.length) * 100, 'Uploading ' + file.name + '...');

      const formData = new FormData();
      formData.append('images[]', file);

      if (isFirst) {
        if (title) formData.append('title', title);
        formData.append('privacy', 'hidden');
        formData.append('nsfw', 'true');
      }

      const url = isFirst
        ? this.apiBaseUrl + '/upload/imgchest/post'
        : this.apiBaseUrl + '/upload/imgchest/post/' + currentPostId + '/add';

      const fetchOptions: RequestInit = { method: 'POST', body: formData };

      const customToken = this.imgchestApiKeyInput?.value.trim();
      if (customToken) {
        fetchOptions.headers = { 'Authorization': 'Bearer ' + customToken };
      }

      fetch(url, fetchOptions)
        .then(response => response.text())
        .then(text => {
          try {
            const data = JSON.parse(text);
            if (data.error) {
              let errorMsg = data.error;
              if (data.details) {
                errorMsg += ': ' + (typeof data.details === 'object' ? JSON.stringify(data.details) : data.details);
              }
              throw new Error(errorMsg);
            }

            if (isFirst) {
              currentPostId = data.data.id;
              const postResult: UploadResult = { type: 'success', url: 'https://imgchest.com/p/' + data.data.id, isPost: true };
              results.push(postResult);
              this.addIncrementalResult(postResult, results.length - 1);
            }

            let newImages: Array<{ link: string }>;
            if (!isFirst) {
              newImages = data.data.images.slice(-1);
            } else {
              newImages = data.data.images;
            }

            for (const img of newImages) {
              const imgResult: UploadResult = { type: 'success', url: img.link };
              results.push(imgResult);
              this.addIncrementalResult(imgResult, results.length - 1);
            }

            completedFiles++;
            this.updateProgress((completedFiles / files.length) * 100, 'Uploaded ' + completedFiles + ' of ' + files.length);
            uploadNextFile(index + 1);
          } catch (e) {
            const errResult: UploadResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + (e as Error).message };
            results.push(errResult);
            this.addIncrementalResult(errResult, results.length - 1);
            completedFiles++;

            if (currentPostId || index > 0) {
              uploadNextFile(index + 1);
            } else {
              this.updateProgress(100, 'Done!');
              this.displayResults(results, totalFiles);
            }
          }
        })
        .catch(error => {
          const errResult: UploadResult = { type: 'error', message: 'Failed to upload ' + file.name + ': ' + error.message };
          results.push(errResult);
          this.addIncrementalResult(errResult, results.length - 1);
          completedFiles++;

          if (currentPostId || index > 0) {
            uploadNextFile(index + 1);
          } else {
            this.updateProgress(100, 'Done!');
            this.displayResults(results, totalFiles);
          }
        });
    };

    uploadNextFile(0);
  }

  private updateProgress(percent: number, text: string): void {
    this.progressFill.style.width = percent + '%';
    this.progressText.textContent = text;
  }

  private addIncrementalResult(result: UploadResult, index: number): void {
    const item = document.createElement('div');
    item.className = 'result-item ' + result.type;

    if (result.isAlbum || result.isCollection || result.isPost) {
      item.className += ' highlight';
    }

    item.setAttribute('data-result-index', String(index));
    item.id = 'result-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

    if (result.type === 'success') {
      if (result.isAlbum) {
        item.innerHTML = 'Album: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
      } else if (result.isCollection) {
        item.innerHTML = 'Collection: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
      } else if (result.isPost) {
        item.innerHTML = 'Post: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
      } else {
        item.innerHTML = '<a href="' + result.url + '" target="_blank">' + result.url + '</a>';
      }
    } else {
      item.textContent = result.message || '';
    }

    const insertAfterSummary = result.isAlbum || result.isCollection || result.isPost;
    const summaryContainer = this.resultsContent.querySelector('#final-summary');
    const existingItems = this.resultsContent.querySelectorAll('.result-item');

    if (insertAfterSummary) {
      if (summaryContainer?.nextSibling) {
        this.resultsContent.insertBefore(item, summaryContainer.nextSibling);
      } else if (summaryContainer) {
        this.resultsContent.appendChild(item);
      } else if (existingItems.length > 0) {
        this.resultsContent.insertBefore(item, existingItems[0]);
      } else {
        this.resultsContent.appendChild(item);
      }
    } else {
      this.resultsContent.appendChild(item);
    }

    setTimeout(() => {
      item.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
  }

  private setLoading(loading: boolean): void {
    this.uploadBtn.disabled = loading;
    const btnText = this.uploadBtn.querySelector('.btn-text') as HTMLElement;
    const btnLoading = this.uploadBtn.querySelector('.btn-loading') as HTMLElement;
    btnText.style.display = loading ? 'none' : 'inline';
    btnLoading.style.display = loading ? 'inline' : 'none';
  }

  private displayResults(results: UploadResult[], totalFiles?: number): void {
    this.resultsDiv.style.display = 'block';

    const hasSummary = this.resultsContent.querySelector('.summary');
    if (hasSummary) hasSummary.remove();

    const imageUploads = results.filter(r => r.type === 'success' && !r.isPost && !r.isAlbum && !r.isCollection).length;
    const failed = results.filter(r => r.type === 'error').length;
    const warnings = results.filter(r => r.type === 'warning').length;

    if (imageUploads > 0) {
      this.uploadCompleted = true;
    }

    const filesCount = totalFiles ?? this.files.length;
    const skipped = warnings > 0 ? filesCount - imageUploads : 0;

    let summaryText = 'Successfully uploaded ' + imageUploads + ' out of ' + filesCount + ' files.';
    if (failed > 0) summaryText += ' ' + failed + ' failed.';
    if (skipped > 0) summaryText += ' ' + skipped + ' skipped (anonymous limit).';

    const summary = document.createElement('div');
    summary.className = 'summary ' + (failed > 0 ? 'warning' : 'success');
    summary.textContent = summaryText;

    const summaryContainer = document.createElement('div');
    summaryContainer.id = 'final-summary';
    summaryContainer.appendChild(summary);

    const existingItems = this.resultsContent.querySelectorAll('.result-item');
    this.resultsContent.insertBefore(summaryContainer, existingItems.length > 0 ? existingItems[0] : null);

    const specialIndices: number[] = [];
    const normalIndices: number[] = [];

    for (let i = 0; i < results.length; i++) {
      if (results[i].isAlbum || results[i].isCollection || results[i].isPost) {
        specialIndices.push(i);
      } else {
        normalIndices.push(i);
      }
    }
    const sortedIndices = [...specialIndices, ...normalIndices];

    const newItems: HTMLElement[] = [];

    for (const i of sortedIndices) {
      const result = results[i];
      const existingItem = this.resultsContent.querySelector('[data-result-index="' + i + '"]') as HTMLElement;

      if (!existingItem) {
        const item = document.createElement('div');
        item.className = 'result-item ' + result.type;
        if (result.isAlbum || result.isCollection || result.isPost) {
          item.className += ' highlight';
        }
        item.setAttribute('data-result-index', String(i));

        if (result.type === 'success') {
          if (result.isAlbum) {
            item.innerHTML = 'Album: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
          } else if (result.isCollection) {
            item.innerHTML = 'Collection: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
          } else if (result.isPost) {
            item.innerHTML = 'Post: <a href="' + result.url + '" target="_blank">' + result.url + '</a>';
          } else {
            item.innerHTML = '<a href="' + result.url + '" target="_blank">' + result.url + '</a>';
          }
        } else if (result.type === 'warning') {
          item.textContent = result.message || '';
        } else {
          item.textContent = result.message || '';
        }

        newItems.push(item);
      } else {
        if (result.isAlbum || result.isCollection || result.isPost) {
          if (!existingItem.classList.contains('highlight')) {
            existingItem.classList.add('highlight');
          }
        }
        newItems.push(existingItem);
      }
    }

    for (const item of newItems) {
      this.resultsContent.appendChild(item);
    }

    setTimeout(() => {
      this.resultsDiv.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 100);
  }

  private showError(message: string): void {
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '<div class="result-item error">' + message + '</div>';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new ImageUploader();
});
