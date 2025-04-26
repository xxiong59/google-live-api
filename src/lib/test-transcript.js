// Example code for OpenAI Realtime API audio transcription
// This example uses browser WebSocket API and assumes audio recording with Web Audio API

// Configuration
const REALTIME_URL = 'wss://api.openai.com/v1/realtime?intent=transcription';

export class RealtimeTranscription {
  constructor() {
    this.websocket = null;
    this.audioContext = null;
    this.mediaStream = null;
    this.scriptProcessor = null;
    this.isRecording = false;
    this.transcriptionResults = [];
  }

  // Initialize WebSocket connection
  initWebSocket() {
    this.websocket = new WebSocket(
        "wss://api.openai.com/v1/realtime?intent=transcription",
        [
          "realtime",
          // Auth
          "openai-insecure-api-key.",
          // Optional
        //   "openai-organization." + OPENAI_ORG_ID,
        //   "openai-project." + OPENAI_PROJECT_ID,
          // Beta protocol, required
          "openai-beta.realtime-v1"
        ]
      );
    
    this.websocket.onopen = () => {
      console.log('WebSocket connection established');
    //   this.configureTranscriptionSession();
      this.websocket.send(
        JSON.stringify({
          event_id: "event_123",
          type: "session.update",
          session: {
            modalities: ["text", "audio"],
            instructions: "transcribe audio",
            input_audio_format: "pcm16",
            input_audio_transcription: {
              model: "whisper-1",
            },
          },
        })
      );
    //   this.websocket.send(
    //     JSON.stringify({
    //       event_id: "event_123",
    //       type: "input_audio_buffer.clear",
    //     })
    //   );
    };
    
    this.websocket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      this.handleWebSocketMessage(message);
    };
    
    this.websocket.onerror = (error) => {
      console.error('WebSocket error:', error);
    };
    
    this.websocket.onclose = () => {
      console.log('WebSocket connection closed');
      this.isRecording = false;
    };
  }

  // Configure the transcription session
  configureTranscriptionSession() {
    const config = {
        "id": "sess_BBwZc7cFV3XizEyKGDCGL",
        "object": "realtime.transcription_session",
      type: 'transcription_session.update',
      
      input_audio_format: 'pcm16',
      input_audio_transcription: {
        model: 'whisper-1',
        prompt: '',
        language: 'en'  // Optional: specify language code
      },
      turn_detection: {
        type: 'server_vad',
        threshold: 0.5,
        prefix_padding_ms: 300,
        silence_duration_ms: 500,
      },
      input_audio_noise_reduction: {
        type: 'near_field'
      },
      include: [
        'item.input_audio_transcription.logprobs'
      ]
    };
    
    // Add authentication header
    
    
    // Send configuration
    this.websocket.send(JSON.stringify(config));
  }

  // Handle incoming WebSocket messages
  handleWebSocketMessage(message) {
    switch (message.type) {
      case 'transcription_session.update':
        console.log('Transcription session updated:', message);
        break;
        
      case 'input_audio_buffer.committed':
        console.log('Audio buffer committed:', message.item_id);
        break;
        
      case 'item.transcription.partial':
        this.updateTranscription(message.text, false);
        break;
        
      case 'item.transcription.final':
        this.updateTranscription(message.text, true);
        this.transcriptionResults.push(message);
        break;
        
      default:
        console.log('Received message:', message);
    }
  }

  updateTranscription(text, isFinal) {
    console.log(`${isFinal ? 'Final' : 'Partial'} transcription: ${text}`);
    // Update UI with transcription text
    // Example: document.getElementById('transcription').innerText = text;
  }

  uploadAudio(base64Audio) {
    if (this.websocket && this.websocket.readyState === WebSocket.OPEN) {
        this.websocket.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Audio
        }));
      }
  }
}
