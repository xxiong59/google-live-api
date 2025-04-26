// Use browser's native WebSocket
const API_KEY = "8c7e6f56afb146248fe624b47142d5d2";
const SAMPLE_RATE = 16000; // 16kHz sample rate

export class AssemblyAi {
  public ws: WebSocket | null = null;

  init(): void {
    this.ws = new WebSocket(
      `wss://api.assemblyai.com/v2/realtime/ws?sample_rate=${SAMPLE_RATE}&token=${API_KEY}`
    );
    
    // Set the authorization header via a message after connection
    this.ws.onopen = () => {
      if (this.ws) {
        this.ws.send(JSON.stringify({ authorization: API_KEY }));
        this.onOpen(this.ws);
      }
    };
    
    this.ws.onmessage = (event) => {
      if (this.ws) this.onMessage(this.ws, event.data);
    };
    
    this.ws.onerror = (event) => {
      if (this.ws) this.onError(this.ws, new Error("WebSocket error occurred"));
    };
    
    this.ws.onclose = (event) => {
      if (this.ws) this.onClose(this.ws, event.code, event.reason);
    };
  }

  onOpen(ws: WebSocket): void {
    console.log('WebSocket connection established');
    // Browser microphone implementation
    // You can implement browser microphone access like this:
    /*
    navigator.mediaDevices.getUserMedia({ audio: true })
      .then(stream => {
        const mediaRecorder = new MediaRecorder(stream);
        const audioChunks: Blob[] = [];
        
        mediaRecorder.addEventListener("dataavailable", event => {
          audioChunks.push(event.data);
        });
        
        mediaRecorder.addEventListener("stop", () => {
          // Process audio when stopped
        });
        
        // Start recording
        mediaRecorder.start(100); // Collect data every 100ms
      })
      .catch(err => {
        console.error(`Error accessing microphone: ${err}`);
      });
    */
  }

  onMessage(ws: WebSocket, message: string | ArrayBuffer | Blob): void {
    try {
      // Handle different message types
      let messageString: string;
      
      if (typeof message === 'string') {
        messageString = message;
      } else if (message instanceof ArrayBuffer) {
        messageString = new TextDecoder().decode(message);
      } else if (message instanceof Blob) {
        // For Blob data, need to read it asynchronously
        // This is a simplified approach - in real code, you'd need to handle this properly
        console.warn("Received Blob data - not handled in this example");
        return;
      } else {
        console.error("Unknown message format");
        return;
      }
      
      const msg = JSON.parse(messageString);
      const msgType = msg.message_type;

      if (msgType === 'SessionBegins') {
        const sessionId = msg.session_id;
        console.log(`Session ID: ${sessionId}`);
        return;
      }

      const text = msg.text || '';
      if (!text) {
        return;
      }

      if (msgType === 'PartialTranscript') {
        console.log(`Partial: ${text}`);
      } else if (msgType === 'FinalTranscript') {
        console.log(`Final: ${text}`);
      } else if (msgType === 'error') {
        console.error(`Error: ${msg.error || 'Unknown error'}`);
      }
    } catch (e) {
      console.error(`Error handling message: ${e}`);
    }
  }

  onError(ws: WebSocket, error: Error): void {
    console.error(`Error: ${error}`);
  }

  onClose(ws: WebSocket, code: number, reason: string): void {
    console.log(`Disconnected: Code ${code}, Reason: ${reason}`);
  }

  // Add a method to close the connection cleanly
  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close();
      this.ws = null;
    }
  }
  
  // Add a method to send audio data
  sendAudio(audioData: ArrayBuffer): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    } else {
      console.warn('WebSocket is not open. Cannot send audio data.');
    }
  }
}