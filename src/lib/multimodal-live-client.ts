/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Content, GenerativeContentBlob, Part } from "@google/generative-ai";
import { EventEmitter } from "eventemitter3";
import { difference } from "lodash";
import {
  ClientContentMessage,
  isInterrupted,
  isModelTurn,
  isServerContentMessage,
  isSetupCompleteMessage,
  isToolCallCancellationMessage,
  isToolCallMessage,
  isTurnComplete,
  LiveIncomingMessage,
  ModelTurn,
  RealtimeInputMessage,
  ServerContent,
  SetupMessage,
  StreamingLog,
  ToolCall,
  ToolCallCancellation,
  ToolResponseMessage,
  type LiveConfig,
} from "../multimodal-live-types";
import { blobToJSON, base64ToArrayBuffer } from "./utils";
import {getMistyInstance} from "../misty/MistyProvider"
import { useRef, useState } from "react";
import { RealtimeTranscription } from "./test-transcript";
import {AssemblyAi} from "./assemblyAi"

/**
 * the events that this client will emit
 */
interface MultimodalLiveClientEventTypes {
  open: () => void;
  log: (log: StreamingLog) => void;
  close: (event: CloseEvent) => void;
  audio: (data: ArrayBuffer) => void;
  content: (data: ServerContent) => void;
  interrupted: () => void;
  setupcomplete: () => void;
  turncomplete: () => void;
  toolcall: (toolCall: ToolCall) => void;
  toolcallcancellation: (toolcallCancellation: ToolCallCancellation) => void;
}

export type MultimodalLiveAPIClientConnection = {
  url?: string;
  apiKey: string;
};

interface TranscriptEntry {
  id: number;
  timestamp: string;
  question: string;
  answer: string;
}

interface Conversation {
  id: number;
  title: string;
  startTime: string;
  transcripts: TranscriptEntry[];
}

/**
 * A event-emitting class that manages the connection to the websocket and emits
 * events to the rest of the application.
 * If you dont want to use react you can still use this.
 */
export class MultimodalLiveClient extends EventEmitter<MultimodalLiveClientEventTypes> {
  public ws: WebSocket | null = null;
  protected config: LiveConfig | null = null;
  public url: string = "";
  private misty = getMistyInstance("");
  private assemblyAi = new AssemblyAi();
  private transcript = new RealtimeTranscription();
  private isFirstReceive = true;
  private timeID: NodeJS.Timer | undefined;
  private emotion = ["trust", "joy"];
  private emotionIndex = 0;
  // private transcriptHistory: TranscriptEntry[] = [];
  private conversationHistory: Conversation[] = [];
  private currentConversation: Conversation | null = null;
  public getConfig() {
    return { ...this.config };
  }

  constructor({ url, apiKey }: MultimodalLiveAPIClientConnection) {
    super();
    url =
      url ||
      `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent`;
    url += `?key=${apiKey}`;
    this.url = url;
    this.send = this.send.bind(this);
  }

  log(type: string, message: StreamingLog["message"]) {
    const log: StreamingLog = {
      date: new Date(),
      type,
      message,
    };
    this.emit("log", log);
  }

  connect(config: LiveConfig): Promise<boolean> {
    this.config = config;

    const ws = new WebSocket(this.url);

    ws.addEventListener("message", async (evt: MessageEvent) => {
      if (evt.data instanceof Blob) {
        this.receive(evt.data);
      } else {
        console.log("non blob message", evt);
      }
    });
    return new Promise((resolve, reject) => {
      const onError = (ev: Event) => {
        this.disconnect(ws);
        const message = `Could not connect to "${this.url}"`;
        this.log(`server.${ev.type}`, message);
        reject(new Error(message));
      };
      ws.addEventListener("error", onError);
      ws.addEventListener("open", (ev: Event) => {
        if (!this.config) {
          reject("Invalid config sent to `connect(config)`");
          return;
        }
        this.log(`client.${ev.type}`, `connected to socket`);
        this.emit("open");

        this.ws = ws;
        this.startNewConversation();
        const setupMessage: SetupMessage = {
          setup: this.config,
        };
        this._sendDirect(setupMessage);
        this.log("client.send", "setup");
        this.assemblyAi.init();
        ws.removeEventListener("error", onError);
        ws.addEventListener("close", (ev: CloseEvent) => {
          console.log(ev);
          this.disconnect(ws);
          let reason = ev.reason || "";
          if (reason.toLowerCase().includes("error")) {
            const prelude = "ERROR]";
            const preludeIndex = reason.indexOf(prelude);
            if (preludeIndex > 0) {
              reason = reason.slice(
                preludeIndex + prelude.length + 1,
                Infinity,
              );
            }
          }
          this.log(
            `server.${ev.type}`,
            `disconnected ${reason ? `with reason: ${reason}` : ``}`,
          );
          this.emit("close", ev);
        });
        resolve(true);
      });
    });
  }

  disconnect(ws?: WebSocket) {
    // could be that this is an old websocket and theres already a new instance
    // only close it if its still the correct reference
    if ((!ws || this.ws === ws) && this.ws) {
      this.ws.close();
      this.ws = null;
      this.log("client.close", `Disconnected`);
      return true;
    }
    return false;
  }

  protected async receive(blob: Blob) {
    const response: LiveIncomingMessage = (await blobToJSON(
      blob,
    )) as LiveIncomingMessage;
    if (isToolCallMessage(response)) {
      this.log("server.toolCall", response);
      this.emit("toolcall", response.toolCall);
      return;
    }
    if (isToolCallCancellationMessage(response)) {
      this.log("receive.toolCallCancellation", response);
      this.emit("toolcallcancellation", response.toolCallCancellation);
      return;
    }

    if (isSetupCompleteMessage(response)) {
      this.log("server.send", "setupComplete");
      this.transcript.initWebSocket();
      this.emit("setupcomplete");
      return;
    }

    // this json also might be `contentUpdate { interrupted: true }`
    // or contentUpdate { end_of_turn: true }
    if (isServerContentMessage(response)) {
      const { serverContent } = response;
      if (isInterrupted(serverContent)) {
        this.log("receive.serverContent", "interrupted");
        this.emit("interrupted");
        return;
      }
      if (isTurnComplete(serverContent)) {
        console.log("server.send", "isTurnComplete");
        this.log("server.send", "turnComplete");
        this.emit("turncomplete");
        //plausible theres more to the message, continue
        this.isFirstReceive = true;
        // this.misty?.executeBehavior("default");
        clearInterval(this.timeID);
        this.get_transcript();
      }

      if (isModelTurn(serverContent)) {
        console.log("server.send", "isModelTurn");
        if (this.isFirstReceive === true) {
          // this.misty?.executeBehavior("trust");
          this.timeID = setInterval(() => {
            // this.misty?.executeBehavior(this.emotion[this.emotionIndex])
            if (this.emotionIndex === 0) {
              this.emotionIndex = 1;
            } else {
              this.emotionIndex = 0;
            }
          }, 3000)
          this.isFirstReceive = false;
        }
        let parts: Part[] = serverContent.modelTurn.parts;

        // when its audio that is returned for modelTurn
        const audioParts = parts.filter(
          (p) => p.inlineData && p.inlineData.mimeType.startsWith("audio/pcm"),
        );
        const base64s = audioParts.map((p) => p.inlineData?.data);

        // strip the audio parts out of the modelTurn
        const otherParts = difference(parts, audioParts);
        // console.log("otherParts", otherParts);

        base64s.forEach((b64) => {
          if (b64) {
            const data = base64ToArrayBuffer(b64);
            this.transcript.uploadAudio(b64);
            this.send_transcript(b64, "a");
            // if (this.assemblyAi.ws?.readyState === WebSocket.OPEN) {
            //     this.assemblyAi.sendAudio(data)
            // }
            this.emit("audio", data);
            this.log(`server.audio`, `buffer (${data.byteLength})`);
          }
        });
        if (!otherParts.length) {
          // console.log("server.send", "other part is empty");
          return;
        }
        
        parts = otherParts;
        console.log("server.send", parts);
        const content: ModelTurn = { modelTurn: { parts } };
        this.emit("content", content);
        this.log(`server.content`, response);
      }
    } else {
      console.log("received unmatched message", response);
    }
  }

  /**
   * send realtimeInput, this is base64 chunks of "audio/pcm" and/or "image/jpg"
   */
  sendRealtimeInput(chunks: GenerativeContentBlob[]) {
    let hasAudio = false;
    let hasVideo = false;
    for (let i = 0; i < chunks.length; i++) {
      const ch = chunks[i];
      if (ch.mimeType.includes("audio")) {
        hasAudio = true;
      }
      if (ch.mimeType.includes("image")) {
        hasVideo = true;
      }
      if (hasAudio && hasVideo) {
        break;
      }
      this.send_transcript(ch.data, "q");
    }
    const message =
      hasAudio && hasVideo
        ? "audio + video"
        : hasAudio
          ? "audio"
          : hasVideo
            ? "video"
            : "unknown";

    const data: RealtimeInputMessage = {
      realtimeInput: {
        mediaChunks: chunks,
      },
    };
    this._sendDirect(data);

    this.log(`client.realtimeInput`, message);
  }

  /**
   *  send a response to a function call and provide the id of the functions you are responding to
   */
  sendToolResponse(toolResponse: ToolResponseMessage["toolResponse"]) {
    const message: ToolResponseMessage = {
      toolResponse,
    };

    this._sendDirect(message);
    this.log(`client.toolResponse`, message);
  }

  /**
   * send normal content parts such as { text }
   */
  send(parts: Part | Part[], turnComplete: boolean = true) {
    parts = Array.isArray(parts) ? parts : [parts];
    const content: Content = {
      role: "user",
      parts,
    };

    const clientContentRequest: ClientContentMessage = {
      clientContent: {
        turns: [content],
        turnComplete,
      },
    };

    this._sendDirect(clientContentRequest);
    this.log(`client.send`, clientContentRequest);
  }

  /**
   *  used internally to send all messages
   *  don't use directly unless trying to send an unsupported message type
   */
  _sendDirect(request: object) {
    if (!this.ws) {
      throw new Error("WebSocket is not connected");
    }
    const str = JSON.stringify(request);
    this.ws.send(str);
  }

  async send_transcript(audioBase64Data: string, source: string) {
    try {
      const response = await fetch('http://localhost:8000/transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          audio_data: audioBase64Data,
          language_code: 'en-US',  // 英语识别
          sample_rate: 16000,       // 采样率
          source: source,
        })
      });
      
      // 解析响应
      const result = await response.json();
      
      // 处理结果
      if (result.error) {
        console.error('识别错误:', result.error);
      } else {
        // console.log('识别文本:', result.q_text);
        // console.log('是否为最终结果:', result.is_final);
      }
      
      return result;
    } catch (error) {
      console.error('请求失败:', error);
      return { text: '', is_final: false};
    }
  }

  async get_transcript() {
    try {
      const response = await fetch('http://localhost:8000/get_transcribe', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });
      
      // 解析响应
      const result = await response.json();
      
      // 处理结果
      if (result.error) {
        console.error('识别错误:', result.error);
      } else {
        console.log('识别文本q:', result.q_text);
        console.log('识别文本a:', result.a_text);
        console.log('是否为最终结果:', result.is_final);
        this.log("transcribe", "q: " + result.q_text);
        this.log("transcribe", "a: " + result.a_text);
        this.saveTranscript(result.q_text, result.a_text)
      }
      
      return result;
    } catch (error) {
      console.error('请求失败:', error);
      return { text: '', is_final: false};
    }
  }

  saveTranscript(qText: string, aText: string) {
    // Create a new transcript entry with timestamp
    const transcriptEntry: TranscriptEntry = {
      id: Date.now(), // Unique ID using timestamp
      timestamp: new Date().toISOString(),
      question: qText,
      answer: aText
    };

    if (!this.currentConversation) {
      this.startNewConversation();
    }

    this.currentConversation!.transcripts.push(transcriptEntry);

    return transcriptEntry;
  }

  startNewConversation(title: string = `Conversation ${this.conversationHistory.length + 1}`): Conversation {
    const newConversation: Conversation = {
      id: Date.now(),
      title: title,
      startTime: new Date().toISOString(),
      transcripts: []
    };
    
    // Set as current conversation
    this.currentConversation = newConversation;
    
    // Add to history
    this.conversationHistory.push(newConversation);
  
    
    return newConversation;
  }
}


