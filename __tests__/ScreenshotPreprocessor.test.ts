import { ScreenshotPreprocessor } from '../src/agent/ScreenshotPreprocessor';

describe('ScreenshotPreprocessor.preprocess', () => {
  describe('file:// URI handling', () => {
    it('strips a file:// prefix and sets wasNormalized=true', () => {
      const result = ScreenshotPreprocessor.preprocess('file:///data/local/tmp/screen.png');
      expect(result.path).toBe('/data/local/tmp/screen.png');
      expect(result.wasNormalized).toBe(true);
    });

    it('handles file:// URI with two slashes (file://path)', () => {
      const result = ScreenshotPreprocessor.preprocess('file:///sdcard/DCIM/screen.jpg');
      expect(result.path).toBe('/sdcard/DCIM/screen.jpg');
      expect(result.wasNormalized).toBe(true);
    });
  });

  describe('plain path pass-through', () => {
    it('returns a plain absolute path unchanged with wasNormalized=false', () => {
      const result = ScreenshotPreprocessor.preprocess('/data/user/0/screenshot.png');
      expect(result.path).toBe('/data/user/0/screenshot.png');
      expect(result.wasNormalized).toBe(false);
    });

    it('returns a relative path unchanged', () => {
      const result = ScreenshotPreprocessor.preprocess('tmp/screenshot.png');
      expect(result.path).toBe('tmp/screenshot.png');
      expect(result.wasNormalized).toBe(false);
    });
  });

  describe('validation', () => {
    it('throws on an empty string', () => {
      expect(() => ScreenshotPreprocessor.preprocess('')).toThrow(
        'rawPath must be a non-empty string',
      );
    });

    it('throws on a whitespace-only string', () => {
      expect(() => ScreenshotPreprocessor.preprocess('   ')).toThrow(
        'rawPath must be a non-empty string',
      );
    });

    it('throws on an http:// URL', () => {
      expect(() =>
        ScreenshotPreprocessor.preprocess('http://example.com/screen.png'),
      ).toThrow('remote URLs are not supported');
    });

    it('throws on an https:// URL', () => {
      expect(() =>
        ScreenshotPreprocessor.preprocess('https://cdn.example.com/screen.png'),
      ).toThrow('remote URLs are not supported');
    });
  });
});

describe('ScreenshotPreprocessor.normalizePath', () => {
  it('returns the normalized path string directly', () => {
    expect(
      ScreenshotPreprocessor.normalizePath('file:///tmp/screenshot.png'),
    ).toBe('/tmp/screenshot.png');
  });

  it('returns a plain path unchanged', () => {
    expect(
      ScreenshotPreprocessor.normalizePath('/data/screenshot.png'),
    ).toBe('/data/screenshot.png');
  });

  it('throws for empty input (delegates to preprocess)', () => {
    expect(() => ScreenshotPreprocessor.normalizePath('')).toThrow();
  });
});

describe('ScreenshotPreprocessor.buildVisionPrompt', () => {
  it('prepends the image attachment header to the prompt', () => {
    const result = ScreenshotPreprocessor.buildVisionPrompt('What is on screen?');
    expect(result).toContain('[Image of current phone screen attached]');
    expect(result).toContain('What is on screen?');
  });

  it('puts the image token before the prompt text', () => {
    const result = ScreenshotPreprocessor.buildVisionPrompt('Tap the Settings icon');
    const imageTokenIdx = result.indexOf('[Image of current phone screen attached]');
    const promptIdx = result.indexOf('Tap the Settings icon');
    expect(imageTokenIdx).toBeLessThan(promptIdx);
  });

  it('preserves the full prompt text', () => {
    const prompt = 'Multi-line\nprompt here';
    const result = ScreenshotPreprocessor.buildVisionPrompt(prompt);
    expect(result).toContain(prompt);
  });
});
