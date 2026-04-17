/**
 * react-native-device-agent — Example App
 *
 * A minimal Expo app demonstrating how to build a phone agent interface
 * using react-native-device-agent.
 *
 * Features demonstrated:
 *   - useAgentChat hook for streaming agent events into chat messages
 *   - CloudProvider for OpenAI/Anthropic cloud fallback
 *   - GemmaProvider for on-device inference (requires model download)
 *   - FallbackProvider for automatic on-device → cloud escalation
 *   - Stopping a running agent mid-task
 *
 * Setup:
 *   1. Install dependencies: npm install
 *   2. Run: npx expo start
 *   3. On a physical Android device with AccessibilityService granted:
 *      set PROVIDER=gemma in the config below.
 *   4. For cloud mode: set PROVIDER=cloud and enter your API key.
 */

import React, { useState } from 'react';
import {
  FlatList,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';

import {
  CloudProvider,
  GemmaProvider,
  FallbackProvider,
  useAgentChat,
  type ChatMessage,
  type UseAgentChatState,
} from 'react-native-device-agent';

// ---------------------------------------------------------------------------
// Config — edit these to match your setup
// ---------------------------------------------------------------------------

/**
 * Which provider to use for LLM inference.
 *
 *   'cloud'    — call OpenAI or Anthropic (requires API key below)
 *   'gemma'    — on-device Gemma 4 via ExecuTorch (requires model download)
 *   'fallback' — try Gemma first, escalate to cloud for complex tasks
 */
const PROVIDER: 'cloud' | 'gemma' | 'fallback' = 'cloud';

/** Your OpenAI or Anthropic API key (only needed when PROVIDER='cloud' or 'fallback'). */
const CLOUD_API_KEY = process.env.EXPO_PUBLIC_CLOUD_API_KEY ?? 'YOUR_API_KEY';

/** Cloud model to use. Anthropic: 'claude-sonnet-4-6'. OpenAI: 'gpt-4o'. */
const CLOUD_MODEL = 'claude-sonnet-4-6';

// ---------------------------------------------------------------------------
// Provider factory
// ---------------------------------------------------------------------------

function makeProvider() {
  const isAnthropic = CLOUD_MODEL.startsWith('claude');
  const cloud = new CloudProvider({
    apiKey: CLOUD_API_KEY,
    model: CLOUD_MODEL,
    baseUrl: isAnthropic
      ? 'https://api.anthropic.com/v1'
      : 'https://api.openai.com/v1',
    apiFormat: isAnthropic ? 'anthropic' : 'openai',
  });

  switch (PROVIDER) {
    case 'gemma':
      return new GemmaProvider({ model: 'E4B' });
    case 'fallback':
      return new FallbackProvider({ onDevice: new GemmaProvider({ model: 'E4B' }), cloud });
    case 'cloud':
    default:
      return cloud;
  }
}

// ---------------------------------------------------------------------------
// Root component
// ---------------------------------------------------------------------------

export default function App() {
  const { messages, isRunning, sendMessage, stop } = useAgentChat({
    provider: makeProvider(),
    maxSteps: 15,
    settleMs: 500,
  }) satisfies UseAgentChatState;

  const [inputText, setInputText] = useState('');

  function handleSend() {
    const task = inputText.trim();
    if (!task || isRunning) return;
    setInputText('');
    sendMessage(task);
  }

  return (
    <SafeAreaView style={styles.safe}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>device-agent example</Text>
        <Text style={styles.headerSub}>Provider: {PROVIDER}</Text>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        {messages.length === 0 ? (
          <EmptyState />
        ) : (
          <FlatList
            data={messages}
            keyExtractor={(m) => m.id}
            renderItem={({ item }) => <MessageRow message={item} />}
            contentContainerStyle={styles.listContent}
          />
        )}

        {isRunning && (
          <View style={styles.runningBar}>
            <Text style={styles.runningText}>Agent running…</Text>
            <TouchableOpacity onPress={stop} style={styles.stopButton}>
              <Text style={styles.stopText}>Stop</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={styles.inputRow}>
          <TextInput
            style={[styles.input, isRunning && styles.inputDisabled]}
            value={inputText}
            onChangeText={setInputText}
            placeholder={isRunning ? 'Agent is running…' : 'Enter a task (e.g. "Open Settings")'}
            placeholderTextColor="#888"
            onSubmitEditing={handleSend}
            returnKeyType="send"
            editable={!isRunning}
          />
          <TouchableOpacity
            style={[styles.sendButton, (inputText.trim().length === 0 || isRunning) && styles.sendButtonDisabled]}
            onPress={handleSend}
            disabled={inputText.trim().length === 0 || isRunning}
          >
            <Text style={styles.sendText}>Run</Text>
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <View style={styles.empty}>
      <Text style={styles.emptyTitle}>Agent ready</Text>
      <Text style={styles.emptyBody}>
        Type a natural-language task and tap Run. The agent will observe the
        screen, plan actions, and execute them step by step.
      </Text>
      <View style={styles.examples}>
        {[
          'Open Settings and turn on Wi-Fi',
          'Search for "weather today" in Chrome',
          'Send a message to the last contact',
        ].map((t) => (
          <View key={t} style={styles.exampleChip}>
            <Text style={styles.exampleText}>{t}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Message row
// ---------------------------------------------------------------------------

function MessageRow({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';

  // Screen state labels render as a centered divider
  if (message.role === 'agent' && message.kind === 'screen') {
    return (
      <View style={styles.screenRow}>
        <View style={styles.screenLine} />
        <Text style={styles.screenLabel}>{message.text}</Text>
        <View style={styles.screenLine} />
      </View>
    );
  }

  // Agent action bullets
  if (message.role === 'agent' && message.kind === 'action') {
    return (
      <View style={styles.actionRow}>
        <View style={[styles.actionDot, message.pending && styles.actionDotPending]} />
        <Text style={styles.actionText}>{message.text}</Text>
      </View>
    );
  }

  // User and agent chat bubbles
  return (
    <View style={[styles.bubbleRow, isUser ? styles.bubbleRowRight : styles.bubbleRowLeft]}>
      <View style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleAgent]}>
        <Text style={[styles.bubbleText, isUser ? styles.bubbleTextUser : styles.bubbleTextAgent]}>
          {message.text}
        </Text>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#0f0f0f' },
  flex: { flex: 1 },

  header: {
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1e1e1e',
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#fff' },
  headerSub: { fontSize: 12, color: '#555', marginTop: 2 },

  listContent: { padding: 16, gap: 8 },

  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32, gap: 12 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#fff' },
  emptyBody: { fontSize: 14, color: '#666', textAlign: 'center', lineHeight: 20 },
  examples: { gap: 8, alignItems: 'center', marginTop: 8 },
  exampleChip: {
    paddingVertical: 6,
    paddingHorizontal: 14,
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#2a2a2a',
  },
  exampleText: { fontSize: 13, color: '#aaa' },

  bubbleRow: { flexDirection: 'row' },
  bubbleRowLeft: { justifyContent: 'flex-start' },
  bubbleRowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '80%', borderRadius: 16, paddingVertical: 8, paddingHorizontal: 12 },
  bubbleUser: { backgroundColor: '#fff' },
  bubbleAgent: { backgroundColor: '#1a1a1a', borderWidth: 1, borderColor: '#2a2a2a' },
  bubbleText: { fontSize: 14, lineHeight: 20 },
  bubbleTextUser: { color: '#0f0f0f' },
  bubbleTextAgent: { color: '#e0e0e0' },

  actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 4 },
  actionDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#4ADE80', flexShrink: 0 },
  actionDotPending: { backgroundColor: '#888' },
  actionText: { fontSize: 13, color: '#888', flex: 1 },

  screenRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: 4 },
  screenLine: { flex: 1, height: 1, backgroundColor: '#1e1e1e' },
  screenLabel: { fontSize: 11, color: '#3a3a3a', fontWeight: '500', textTransform: 'uppercase', letterSpacing: 0.5 },

  runningBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 8,
    backgroundColor: '#0d1f0d',
    borderTopWidth: 1,
    borderTopColor: '#1a3a1a',
  },
  runningText: { flex: 1, fontSize: 13, color: '#4ADE80' },
  stopButton: {
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: '#1a3a1a',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#4ADE80',
  },
  stopText: { fontSize: 12, color: '#4ADE80', fontWeight: '600' },

  inputRow: { flexDirection: 'row', alignItems: 'center', padding: 12, gap: 8, borderTopWidth: 1, borderTopColor: '#1e1e1e' },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#1a1a1a',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: '#2a2a2a',
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#fff',
  },
  inputDisabled: { opacity: 0.5 },
  sendButton: {
    height: 44,
    paddingHorizontal: 18,
    backgroundColor: '#fff',
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: { backgroundColor: '#2a2a2a' },
  sendText: { fontSize: 14, fontWeight: '700', color: '#0f0f0f' },
});
