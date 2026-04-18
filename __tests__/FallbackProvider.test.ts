import { FallbackProvider } from '../src/providers/FallbackProvider';
import type { GemmaProvider } from '../src/providers/GemmaProvider';
import type { CloudProvider } from '../src/providers/CloudProvider';
import type { Tool } from '../src/types';

// ---------------------------------------------------------------------------
// Mock factory helpers
// ---------------------------------------------------------------------------

function makeOnDevice(
  response = 'on-device response',
): jest.Mocked<Pick<GemmaProvider, 'generate' | 'generateWithTools'>> {
  return {
    generate: jest.fn().mockResolvedValue(response),
    generateWithTools: jest.fn().mockResolvedValue(response),
  };
}

function makeCloud(
  response = 'cloud response',
): jest.Mocked<Pick<CloudProvider, 'generate' | 'generateWithTools'>> {
  return {
    generate: jest.fn().mockResolvedValue(response),
    generateWithTools: jest.fn().mockResolvedValue(response),
  };
}

function makeFailingOnDevice(): jest.Mocked<Pick<GemmaProvider, 'generate' | 'generateWithTools'>> {
  return {
    generate: jest.fn().mockRejectedValue(new Error('on-device failed')),
    generateWithTools: jest.fn().mockRejectedValue(new Error('on-device failed')),
  };
}

const TOOLS: Tool[] = [
  {
    name: 'tap',
    description: 'Tap a UI element',
    parameters: { type: 'object', properties: {}, required: [] },
  },
];

// ---------------------------------------------------------------------------
// generate() tests
// ---------------------------------------------------------------------------

describe('FallbackProvider.generate', () => {
  it('uses the on-device provider for a short prompt', async () => {
    const onDevice = makeOnDevice('on-device result');
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
    });

    const result = await provider.generate('short prompt');

    expect(result).toBe('on-device result');
    expect(onDevice.generate).toHaveBeenCalledTimes(1);
    expect(cloud.generate).not.toHaveBeenCalled();
  });

  it('falls back to cloud when prompt exceeds maxPromptLength', async () => {
    const onDevice = makeOnDevice();
    const cloud = makeCloud('cloud result');
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxPromptLength: 10 },
    });

    const result = await provider.generate('this prompt is longer than 10 characters');

    expect(result).toBe('cloud result');
    expect(onDevice.generate).not.toHaveBeenCalled();
    expect(cloud.generate).toHaveBeenCalledTimes(1);
  });

  it('falls back to cloud when on-device throws', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud('cloud fallback');
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
    });

    const result = await provider.generate('any prompt');

    expect(result).toBe('cloud fallback');
    expect(cloud.generate).toHaveBeenCalledTimes(1);
  });

  it('increments onDeviceFailures when on-device throws', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 3 },
    });

    expect(provider.isCloudMode).toBe(false);

    await provider.generate('p1');
    await provider.generate('p2');
    await provider.generate('p3');

    expect(provider.isCloudMode).toBe(true);
    // All 3 calls reached on-device first before falling back
    expect(onDevice.generate).toHaveBeenCalledTimes(3);
  });

  it('permanently uses cloud once failure threshold is reached', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 2 },
    });

    // Exhaust the failure budget
    await provider.generate('p1');
    await provider.generate('p2');

    // Now in cloud mode — on-device should not be called again
    jest.clearAllMocks();
    await provider.generate('p3');

    expect(onDevice.generate).not.toHaveBeenCalled();
    expect(cloud.generate).toHaveBeenCalledTimes(1);
  });

  it('resets failure counter on a successful on-device response', async () => {
    const onDevice = makeOnDevice();
    // Simulate one failure then success
    onDevice.generate
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce('ok');
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 3 },
    });

    await provider.generate('first call fails');  // onDeviceFailures → 1
    await provider.generate('second call succeeds'); // onDeviceFailures → 0

    expect(provider.isCloudMode).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// generateWithTools() tests
// ---------------------------------------------------------------------------

describe('FallbackProvider.generateWithTools', () => {
  it('uses on-device for short prompts', async () => {
    const onDevice = makeOnDevice('on-device tools result');
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
    });

    const result = await provider.generateWithTools('short', TOOLS);

    expect(result).toBe('on-device tools result');
    expect(onDevice.generateWithTools).toHaveBeenCalledWith('short', TOOLS);
    expect(cloud.generateWithTools).not.toHaveBeenCalled();
  });

  it('falls back to cloud on long prompt', async () => {
    const onDevice = makeOnDevice();
    const cloud = makeCloud('cloud tools response');
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxPromptLength: 5 },
    });

    const result = await provider.generateWithTools('this prompt is too long', TOOLS);

    expect(result).toBe('cloud tools response');
    expect(onDevice.generateWithTools).not.toHaveBeenCalled();
  });

  it('falls back to cloud when on-device throws', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud('cloud tools fallback');
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
    });

    const result = await provider.generateWithTools('some task', TOOLS);

    expect(result).toBe('cloud tools fallback');
    expect(cloud.generateWithTools).toHaveBeenCalledWith('some task', TOOLS);
  });

  it('tracks failures independently — generateWithTools increments counter', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 2 },
    });

    await provider.generateWithTools('p1', TOOLS);
    await provider.generateWithTools('p2', TOOLS);

    expect(provider.isCloudMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// resetFailureCount() and isCloudMode tests
// ---------------------------------------------------------------------------

describe('FallbackProvider.resetFailureCount', () => {
  it('resets the failure counter, returning to on-device mode', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 2 },
    });

    await provider.generate('p1');
    await provider.generate('p2');
    expect(provider.isCloudMode).toBe(true);

    provider.resetFailureCount();
    expect(provider.isCloudMode).toBe(false);
  });

  it('allows on-device calls again after reset', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 1 },
    });

    await provider.generate('exhaust');    // failure → cloud mode
    provider.resetFailureCount();         // reset

    jest.clearAllMocks();
    await provider.generate('after reset');

    // on-device should be tried again (it will fail again, but it was tried)
    expect(onDevice.generate).toHaveBeenCalledTimes(1);
  });
});

describe('FallbackProvider.isCloudMode', () => {
  it('returns false initially', () => {
    const provider = new FallbackProvider({
      onDevice: makeOnDevice() as unknown as GemmaProvider,
      cloud: makeCloud() as unknown as CloudProvider,
    });
    expect(provider.isCloudMode).toBe(false);
  });

  it('returns true once failures reach maxOnDeviceFailures', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
      complexity: { maxOnDeviceFailures: 1 },
    });

    await provider.generate('trigger failure');
    expect(provider.isCloudMode).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Complexity defaults
// ---------------------------------------------------------------------------

describe('FallbackProvider complexity defaults', () => {
  it('defaults maxPromptLength to 6000 characters', async () => {
    const onDevice = makeOnDevice('ok');
    const cloud = makeCloud('cloud');
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
    });

    // 5999-char prompt should use on-device
    const shortEnough = 'a'.repeat(5999);
    await provider.generate(shortEnough);
    expect(onDevice.generate).toHaveBeenCalledTimes(1);
    expect(cloud.generate).not.toHaveBeenCalled();

    jest.clearAllMocks();

    // 6001-char prompt should bypass on-device
    const tooLong = 'a'.repeat(6001);
    await provider.generate(tooLong);
    expect(onDevice.generate).not.toHaveBeenCalled();
    expect(cloud.generate).toHaveBeenCalledTimes(1);
  });

  it('defaults maxOnDeviceFailures to 3', async () => {
    const onDevice = makeFailingOnDevice();
    const cloud = makeCloud();
    const provider = new FallbackProvider({
      onDevice: onDevice as unknown as GemmaProvider,
      cloud: cloud as unknown as CloudProvider,
    });

    // 2 failures should not yet flip to cloud mode
    await provider.generate('f1');
    await provider.generate('f2');
    expect(provider.isCloudMode).toBe(false);

    // 3rd failure crosses the threshold
    await provider.generate('f3');
    expect(provider.isCloudMode).toBe(true);
  });
});
