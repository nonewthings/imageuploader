import { test, expect, describe, beforeEach } from 'bun:test';
import { Provider, UploadResult, ALLOWED_EXTENSIONS } from '../src/types';

interface MockElement {
  id: string;
  value: string;
  checked: boolean;
  disabled: boolean;
  innerHTML: string;
  textContent: string;
  style: { display: string; width: string; marginTop: string };
  classList: {
    add: (cls: string) => void;
    remove: (cls: string) => void;
    toggle: (cls: string, force?: boolean) => void;
    contains: (cls: string) => boolean;
  };
  addEventListener: (event: string, handler: EventListener) => void;
  querySelector: (selector: string) => MockElement | null;
  querySelectorAll: (selector: string) => MockElement[];
  appendChild: (child: MockElement) => MockElement;
  insertBefore: (newNode: MockElement, refNode?: MockElement | null) => MockElement;
  remove: () => void;
  setAttribute: (attr: string, val: string) => void;
  getAttribute: (attr: string) => string | null;
  scrollIntoView: () => void;
  parentNode: MockElement | null;
  nextSibling: MockElement | null;
  children: MockElement[];
  _listeners: Record<string, EventListener[]>;
  _classList: Set<string>;
  className?: string;
  _btnText?: { style: Record<string, string> };
  _btnLoading?: { style: Record<string, string> };
}

interface MockFile {
  name: string;
  size: number;
  webkitRelativePath?: string;
  mozRelativePath?: string;
}

function createMockElement(id: string, options: { value?: string; checked?: boolean; classList?: string[] } = {}): MockElement {
  const listeners: Record<string, EventListener[]> = {};
  const classList = new Set<string>(options.classList || []);
  const children: MockElement[] = [];
  const attrStore: Record<string, string> = {};

  const element: MockElement = {
    id,
    value: options.value || '',
    checked: options.checked || false,
    disabled: false,
    innerHTML: '',
    textContent: '',
    style: { display: '', width: '', marginTop: '' },
    classList: {
      add: (cls: string) => classList.add(cls),
      remove: (cls: string) => classList.delete(cls),
      toggle: (cls: string, force?: boolean) => {
        if (force === undefined) {
          classList.has(cls) ? classList.delete(cls) : classList.add(cls);
        } else if (force) {
          classList.add(cls);
        } else {
          classList.delete(cls);
        }
      },
      contains: (cls: string) => classList.has(cls),
    },
    addEventListener: (event: string, handler: EventListener) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(handler);
    },
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild: (child: MockElement) => { children.push(child); return child; },
    insertBefore: (newNode: MockElement) => { children.unshift(newNode); return newNode; },
    remove: () => {},
    setAttribute: (attr: string, val: string) => { attrStore[attr] = val; },
    getAttribute: (attr: string) => attrStore[attr] || null,
    scrollIntoView: () => {},
    parentNode: null,
    nextSibling: null,
    get children() { return children; },
    _listeners: listeners,
    _classList: classList,
  };

  return element;
}

interface MockElements {
  uploadForm: MockElement;
  provider: MockElement;
  files: MockElement;
  dropZone: MockElement;
  fileList: MockElement;
  urlGroup: MockElement;
  createCollectionGroup: MockElement;
  sxcuOptions: MockElement;
  anonymousGroup: MockElement;
  postIdGroup: MockElement;
  uploadBtn: MockElement;
  results: MockElement;
  resultsContent: MockElement;
  progress: MockElement;
  progressFill: MockElement;
  progressText: MockElement;
  urls: MockElement;
  title: MockElement;
  postId: MockElement;
  createCollection: MockElement;
}

interface MockLocalStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

class ImageUploaderTestable {
  files: MockFile[] = [];
  provider: Provider;
  uploadCompleted = false;
  apiBaseUrl = 'http://localhost:3000';

  form: MockElement;
  providerSelect: MockElement;
  filesInput: MockElement;
  dropZone: MockElement;
  fileList: MockElement;
  urlGroup: MockElement;
  createCollectionGroup: MockElement;
  sxcuOptions: MockElement;
  anonymousGroup: MockElement;
  postIdGroup: MockElement;
  uploadBtn: MockElement;
  resultsDiv: MockElement;
  resultsContent: MockElement;
  progressDiv: MockElement;
  progressFill: MockElement;
  progressText: MockElement;
  urlsInput: MockElement;
  titleInput: MockElement;
  postIdInput: MockElement;

  _mockElements: MockElements;
  _mockLocalStorage: MockLocalStorage;

  uploadToCatbox?: (results: UploadResult[], urls: string[]) => void;
  uploadToSxcu?: (results: UploadResult[]) => void;
  uploadToImgchest?: (results: UploadResult[]) => void;

  constructor(mockElements: MockElements, mockLocalStorage: MockLocalStorage) {
    this.provider = (mockLocalStorage.getItem('image_uploader_provider') as Provider) || 'imgchest';

    this.form = mockElements.uploadForm;
    this.providerSelect = mockElements.provider;
    this.filesInput = mockElements.files;
    this.dropZone = mockElements.dropZone;
    this.fileList = mockElements.fileList;
    this.urlGroup = mockElements.urlGroup;
    this.createCollectionGroup = mockElements.createCollectionGroup;
    this.sxcuOptions = mockElements.sxcuOptions;
    this.anonymousGroup = mockElements.anonymousGroup;
    this.postIdGroup = mockElements.postIdGroup;
    this.uploadBtn = mockElements.uploadBtn;
    this.resultsDiv = mockElements.results;
    this.resultsContent = mockElements.resultsContent;
    this.progressDiv = mockElements.progress;
    this.progressFill = mockElements.progressFill;
    this.progressText = mockElements.progressText;
    this.urlsInput = mockElements.urls;
    this.titleInput = mockElements.title;
    this.postIdInput = mockElements.postId;

    this._mockElements = mockElements;
    this._mockLocalStorage = mockLocalStorage;
  }

  updateUI(): void {
    const isSxcu = this.provider === 'sxcu';
    const isImgchest = this.provider === 'imgchest';

    this.urlGroup.classList.toggle('hidden', isSxcu || isImgchest);
    this.createCollectionGroup.classList.toggle('hidden', !isSxcu);

    if (this.sxcuOptions) {
      const createCollectionChecked = this._mockElements.createCollection?.checked || false;
      this.sxcuOptions.classList.toggle('hidden', !isSxcu || !createCollectionChecked);
    }

    this.anonymousGroup.classList.toggle('hidden', !isImgchest);
    this.postIdGroup.classList.toggle('hidden', !isImgchest);
  }

  addFiles(fileList: MockFile[]): void {
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

    if (this.files.length > 0 && !this.titleInput.value) {
      const firstFile = this.files[0];
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

  removeFile(index: number): void {
    this.files.splice(index, 1);
    this.renderFileList();
  }

  renderFileList(): void {
    this.fileList.innerHTML = '';
    (this.fileList.children as MockElement[]).length = 0;
    for (let i = 0; i < this.files.length; i++) {
      const file = this.files[i];
      const item = createMockElement('file-item-' + i);
      item.className = 'file-item';
      item.innerHTML = '<span class="file-name">' + file.name + ' (' + this.formatSize(file.size) + ')</span>';
      this.fileList.appendChild(item);
    }
  }

  formatSize(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  }

  handleSubmit(e: { preventDefault: () => void }): void {
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

    const urls = this.urlsInput.value.trim() ? this.urlsInput.value.split(',').map(u => u.trim()) : [];

    try {
      switch (this.provider) {
        case 'catbox':
          if (this.uploadToCatbox) this.uploadToCatbox([], urls);
          break;
        case 'sxcu':
          if (this.uploadToSxcu) this.uploadToSxcu([]);
          break;
        case 'imgchest':
          if (this.uploadToImgchest) this.uploadToImgchest([]);
          break;
      }
    } catch (error) {
      this.showError((error as Error).message);
    } finally {
      this.setLoading(false);
      this.progressDiv.style.display = 'none';
    }
  }

  setLoading(loading: boolean): void {
    this.uploadBtn.disabled = loading;
  }

  displayResults(results: UploadResult[]): void {
    this.resultsDiv.style.display = 'block';
    const imageUploads = results.filter(r =>
      r.type === 'success' && !r.isPost && !r.isAlbum && !r.isCollection
    ).length;
    if (imageUploads > 0) {
      this.uploadCompleted = true;
    }
  }

  showError(message: string): void {
    this.resultsDiv.style.display = 'block';
    this.resultsContent.innerHTML = '<div class="result-item error">' + message + '</div>';
  }
}

function createMockElements(): MockElements {
  const uploadBtn = createMockElement('uploadBtn');
  uploadBtn._btnText = { style: {} };
  uploadBtn._btnLoading = { style: {} };

  return {
    uploadForm: createMockElement('uploadForm'),
    provider: createMockElement('provider', { value: 'imgchest' }),
    files: createMockElement('files'),
    dropZone: createMockElement('dropZone'),
    fileList: createMockElement('fileList'),
    urlGroup: createMockElement('urlGroup'),
    createCollectionGroup: createMockElement('createCollectionGroup'),
    sxcuOptions: createMockElement('sxcuOptions'),
    anonymousGroup: createMockElement('anonymousGroup'),
    postIdGroup: createMockElement('postIdGroup'),
    uploadBtn,
    results: createMockElement('results'),
    resultsContent: createMockElement('resultsContent'),
    progress: createMockElement('progress'),
    progressFill: createMockElement('progressFill'),
    progressText: createMockElement('progressText'),
    urls: createMockElement('urls'),
    title: createMockElement('title'),
    postId: createMockElement('postId'),
    createCollection: createMockElement('createCollection'),
  };
}

function createMockLocalStorage(data: Record<string, string> = {}): MockLocalStorage {
  const store = { ...data };
  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
  };
}

describe('ImageUploader', () => {
  let uploader: ImageUploaderTestable;
  let mockElements: MockElements;
  let mockLocalStorage: MockLocalStorage;

  beforeEach(() => {
    mockElements = createMockElements();
    mockLocalStorage = createMockLocalStorage();
    uploader = new ImageUploaderTestable(mockElements, mockLocalStorage);
  });

  describe('File validation', () => {
    test('accepts valid image extensions', () => {
      const validFiles: MockFile[] = [
        { name: 'photo.png', size: 1000 },
        { name: 'image.jpg', size: 2000 },
        { name: 'animation.gif', size: 3000 },
        { name: 'picture.webp', size: 4000 },
      ];

      uploader.addFiles(validFiles);

      expect(uploader.files.length).toBe(4);
    });

    test('rejects non-image files', () => {
      const invalidFiles: MockFile[] = [
        { name: 'document.pdf', size: 1000 },
        { name: 'script.js', size: 500 },
        { name: 'data.json', size: 200 },
        { name: 'malware.exe', size: 9999 },
      ];

      uploader.addFiles(invalidFiles);

      expect(uploader.files.length).toBe(0);
    });

    test('prevents duplicate files by name and size', () => {
      const file: MockFile = { name: 'photo.png', size: 1000 };

      uploader.addFiles([file]);
      uploader.addFiles([file]);
      uploader.addFiles([{ name: 'photo.png', size: 1000 }]);

      expect(uploader.files.length).toBe(1);
    });

    test('allows same filename with different size', () => {
      uploader.addFiles([{ name: 'photo.png', size: 1000 }]);
      uploader.addFiles([{ name: 'photo.png', size: 2000 }]);

      expect(uploader.files.length).toBe(2);
    });

    test('removes file at specified index', () => {
      uploader.addFiles([
        { name: 'a.png', size: 100 },
        { name: 'b.png', size: 200 },
        { name: 'c.png', size: 300 },
      ]);

      uploader.removeFile(1);

      expect(uploader.files.length).toBe(2);
      expect(uploader.files[0].name).toBe('a.png');
      expect(uploader.files[1].name).toBe('c.png');
    });
  });

  describe('Auto-title generation', () => {
    test('uses filename without extension when no folder path', () => {
      uploader.addFiles([{ name: 'vacation-photo.png', size: 1000 }]);

      expect(uploader.titleInput.value).toBe('vacation-photo');
    });

    test('uses folder name when file has relative path', () => {
      uploader.addFiles([{
        name: 'photo.png',
        size: 1000,
        webkitRelativePath: 'MyAlbum/subfolder/photo.png'
      }]);

      expect(uploader.titleInput.value).toBe('subfolder');
    });

    test('does not overwrite existing title', () => {
      uploader.titleInput.value = 'My Custom Title';
      uploader.addFiles([{ name: 'photo.png', size: 1000 }]);

      expect(uploader.titleInput.value).toBe('My Custom Title');
    });
  });

  describe('Form submission', () => {
    test('shows error when no files or URLs provided', () => {
      uploader.handleSubmit({ preventDefault: () => {} });

      expect(uploader.resultsContent.innerHTML).toContain('Please select at least one file or enter URLs');
    });

    test('allows submission with URLs only', () => {
      uploader.urlsInput.value = 'http://example.com/image.png';
      let providerCalled = false;
      uploader.uploadToCatbox = () => { providerCalled = true; };
      uploader.provider = 'catbox';

      uploader.handleSubmit({ preventDefault: () => {} });

      expect(providerCalled).toBe(true);
    });

    test('routes to correct provider handler', () => {
      uploader.files = [{ name: 'test.png', size: 100 }];
      const calls = { catbox: false, sxcu: false, imgchest: false };

      uploader.uploadToCatbox = () => { calls.catbox = true; };
      uploader.uploadToSxcu = () => { calls.sxcu = true; };
      uploader.uploadToImgchest = () => { calls.imgchest = true; };

      uploader.provider = 'catbox';
      uploader.handleSubmit({ preventDefault: () => {} });
      expect(calls.catbox).toBe(true);

      uploader.provider = 'sxcu';
      uploader.handleSubmit({ preventDefault: () => {} });
      expect(calls.sxcu).toBe(true);

      uploader.provider = 'imgchest';
      uploader.handleSubmit({ preventDefault: () => {} });
      expect(calls.imgchest).toBe(true);
    });

    test('disables upload button during submission', () => {
      uploader.files = [{ name: 'test.png', size: 100 }];
      uploader.uploadToImgchest = () => {
        expect(uploader.uploadBtn.disabled).toBe(true);
      };

      uploader.handleSubmit({ preventDefault: () => {} });
    });
  });

  describe('Provider-specific UI', () => {
    test('catbox shows URL input, hides imgchest options', () => {
      uploader.provider = 'catbox';
      uploader.updateUI();

      expect(uploader.urlGroup._classList.has('hidden')).toBe(false);
      expect(uploader.anonymousGroup._classList.has('hidden')).toBe(true);
      expect(uploader.postIdGroup._classList.has('hidden')).toBe(true);
    });

    test('imgchest shows anonymous and postId options', () => {
      uploader.provider = 'imgchest';
      uploader.updateUI();

      expect(uploader.anonymousGroup._classList.has('hidden')).toBe(false);
      expect(uploader.postIdGroup._classList.has('hidden')).toBe(false);
      expect(uploader.urlGroup._classList.has('hidden')).toBe(true);
    });

    test('sxcu shows collection options', () => {
      uploader.provider = 'sxcu';
      uploader.updateUI();

      expect(uploader.createCollectionGroup._classList.has('hidden')).toBe(false);
      expect(uploader.urlGroup._classList.has('hidden')).toBe(true);
    });
  });

  describe('Upload completion tracking', () => {
    test('marks upload complete when images successfully uploaded', () => {
      const results: UploadResult[] = [
        { type: 'success', url: 'http://example.com/a.png' },
        { type: 'success', url: 'http://example.com/b.png' },
      ];

      uploader.displayResults(results);

      expect(uploader.uploadCompleted).toBe(true);
    });

    test('does not mark complete for album/collection/post only results', () => {
      const results: UploadResult[] = [
        { type: 'success', url: 'http://example.com/album', isAlbum: true },
        { type: 'success', url: 'http://example.com/post', isPost: true },
      ];

      uploader.displayResults(results);

      expect(uploader.uploadCompleted).toBe(false);
    });

    test('does not mark complete when all uploads failed', () => {
      const results: UploadResult[] = [
        { type: 'error', message: 'Failed' },
        { type: 'error', message: 'Also failed' },
      ];

      uploader.displayResults(results);

      expect(uploader.uploadCompleted).toBe(false);
    });
  });
});
