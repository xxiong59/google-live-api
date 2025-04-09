import { Console } from "console";
import { behaviors } from "./behaviorDefinition.js";


let currentVolume = 10;
let videoSocket = null;
let isVideoStreaming = false;

type EmotionKey = keyof typeof emotionToBehavior;
type BehaviorName = typeof emotionToBehavior[EmotionKey];

const emotionToBehavior = {
    annoyed: 'annoyance',
    anticipation: 'anticipation',
    apprehension: 'apprehension',
    bored: 'boredom',
    dancing: 'dancing',
    disgust: 'disgust',
    distracted: 'distraction',
    ecstatic: 'ecstasy',
    elicit: 'elicit',
    fear: 'fear',
    grief: 'grief',
    interest: 'interest',
    joy: 'joy',
    loathing: 'loathing',
    pensive: 'pensiveness',
    rage: 'rage',
    sad: 'sadness',
    serene: 'serenity',
    sleepy: 'sleepy',
    spooked: 'spooked',
    surprised: 'surprise',
    terror: 'terror',
    trust: 'trust',
    vigilant: 'vigilance',
    default: 'default'
};

export class MistyApi {
    private socket!: WebSocket;
    private ipAddress: string;
    private audioCallbacks: Array<() => void> = [];

    constructor(ip: string) {
        this.ipAddress = ip;
        // this.connect2Misty(ip);
    }

    connect2Misty = () => {
        const ip = this.ipAddress
        this.socket = new WebSocket(`ws://${ip}/pubsub`);

        this.socket.onopen = () => {
            console.log('WebSocket connected');
            // You can send an initial command or subscribe to events here
            setTimeout(() => {
                // Now it's safe to register for events
                this.registerForAudioPlayComplete();
                this.registerForBumpSensor();
                this.playAudio("mario_bros_coin.mp3");
                this.getVideoRecordingsList()
            }, 500);
        };

        this.socket.onerror = (error) => {
            console.error('WebSocket error:', error);
        };

        this.socket.onclose = () => {
            console.log('WebSocket closed');
        };

        this.socket.onmessage = (event) => {
            console.log('Message from server:', event.data);
            // Handle incoming messages from the robot
            this.handleMessage(event.data);
        };
    };

    private registerForAudioPlayComplete = () => {
        const subscribeMsg = {
            Operation: 'subscribe',
            Type: 'AudioPlayComplete',
            DebounceMs: 0,
            EventName: 'AudioPlayComplete',
            ReturnProperty: null,
            EventConditions: []
        };
        this.audioCallbacks.forEach(callback => callback());
        this.socket.send(JSON.stringify(subscribeMsg));
    };
    
    private registerForBumpSensor = () => {
        const subscribeMsg = {
            Operation: 'subscribe',
            Type: 'BumpSensor',
            DebounceMs: 0,
            EventName: 'BumpSensor',
            ReturnProperty: null,
            EventConditions: []
        };
        this.socket.send(JSON.stringify(subscribeMsg));
    };

    registerAudioCallback = (callback: () => void) => {
        this.audioCallbacks.push(callback)
    }


    private handleMessage = (data: string) => {
        const message = JSON.parse(data);
        switch (message.eventName) {
            case 'AudioPlayComplete':
                if (message.message && message.message.metaData) {
                    console.log('Audio playback completed');
                    if(message.message.metaData.name!=="mario_bros_coin.mp3"){
                        this.deleteAudio(message.message.metaData.name)
                    }
                } else {
                    console.log('AudioPlayComplete registration status received');
                }
                break;
            case 'BumpSensor':
                this.handleBumpSensorEvent(message)
                break;
            case '':
                break;    
            default:
                console.log('Misty message ${message} ');
                break;
        }
    };

    uploadAudio = async (base64AudioData: any, filename: string) => {
        const uploadResponse = await fetch(`http://${this.ipAddress}/api/audio`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                FileName: filename,
                Data: base64AudioData,
                OverwriteExisting: true,
            })
        });

        console.log("Upload Response from teh Upload audio function : ",uploadResponse);
    
    
        if (!uploadResponse.ok) {
            throw new Error(`Failed to upload audio: ${uploadResponse.statusText}`);
        }
    };

    playAudio = async (filename: string) => {
        const playResponse = await fetch(`http://${this.ipAddress}/api/audio/play`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ AssetId: filename, volume: currentVolume })
        });
    
        if (!playResponse.ok) {
            throw new Error(`Failed to play audio: ${playResponse.statusText}`);
        }
    };

    private deleteAudio = async (filename: string) => {
        try {
        const response = await fetch(`http://${this.ipAddress}/api/audio`, {
            method: 'DELETE',
            headers: {
            'Content-Type': 'application/json'
            },
            body: JSON.stringify({ FileName: filename })
        });
    
        if (!response.ok) {
            throw new Error(`Failed to delete audio: ${response.statusText}`);
        }
    
        const result = await response.json();
        console.log("Successfully deleted file:",result,filename)
        return result.result;
        } catch (error) {
        console.error('Error deleting audio:', error);
        throw error;
        }
    };

    startVedioStreaming = async (processFrameCallback: any) => {
        try {
            const response = await fetch(`http://${this.ipAddress}/api/videostreaming/start`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: JSON.stringify({
                "Port": 6789,
                "Rotation": 0,
                "Width": 640,  // 可调整为你需要的分辨率
                "Height": 480, // 可调整为你需要的分辨率
                "Quality": 75, // 画质与性能的平衡
                "Overlay": false
              })
            });
        
            const data = await response.json();
            
            if (data.result) {
            //   console.log(`视频流已启动，WebSocket地址: ws://${MISTY_IP}:${WEBSOCKET_PORT}`);
                videoSocket = new WebSocket(`ws://${this.ipAddress}:6789`);
                console.log(data)
                videoSocket.onopen = () => {
                    console.log('Connected to video stream');
                    isVideoStreaming = true;
                };
            
                videoSocket.onmessage = (event) => {
                    // Handle video data
                    // processVideoFrame(event.data);
                    // console.log("startVedioStreaming")
                    // console.log(event.data);
                    if (typeof processFrameCallback === 'function') {
                        processFrameCallback(event.data);
                      }
                };
            
                videoSocket.onerror = (error) => {
                    console.error('Video WebSocket error:', error);
                };
            
                videoSocket.onclose = () => {
                    console.log('Video WebSocket closed');
                    isVideoStreaming = false;
                };
                return true;
            } else {
                console.error("启动视频流失败:", data);
                return false;
            }
            } catch (error) {
                console.error("启动视频流时出错:", error);
                return false;
            }
    }


    stopVideoStreaming = async () => {
        try {
          const response = await fetch(`http://${this.ipAddress}/api/videostreaming/stop`, {
            method: 'POST'
          });
          
          const data = await response.json();
          console.log("视频流已停止:", data);
          return true;
        } catch (error) {
          console.error("停止视频流时出错:", error);
          return false;
        }
    }

    getVideoRecordingsList = async () => {
        try {
            const response = await fetch(`http://${this.ipAddress}/api/videos/recordings/list`, {
              method: 'GET'
            });
            
            const data = await response.json();
            console.log("getVideoRecordingsList:", data);
            return true;
          } catch (error) {
            console.error("getVideoRecordingsList:", error);
            return false;
          }
    }

    private handleBumpSensorEvent = (data: any) => {
        if (data.message && data.message.isContacted) {
            const sensorId = data.message.sensorId;
            let bumpSensor;
        
    
            //the placement of the robot changes the bumper mapping
            switch (sensorId) {
                case 'bfl':
                case 'brl':
                    bumpSensor = 'RightBumper';
                    break;
                case 'bfr':
                case 'brr':
                    bumpSensor = 'LeftBumper';
                    break;
                default:
                    console.log('Unknown bump sensor:', sensorId);
                    break;
            }
        }
    };
    // Example usage


    executeBehavior = async (emotion: string) => {
        const behaviorName = emotion in emotionToBehavior ? emotionToBehavior[emotion as EmotionKey] : 'default';
        const behaviorContent = behaviors[behaviorName as keyof typeof behaviors] || behaviors.default;
        const instructions = behaviorContent.split('\n');
        console.log('Executing behavior:', instructions);
        for (const instruction of instructions) {
          const args = instruction.trim().split(' ');
          if (args.length < 2) continue;
          
          switch(args[0]) {
            case 'SL':
              await new Promise(resolve => setTimeout(resolve, parseInt(args[1])));
              break;
            case 'FI':
              console.log('Displaying image:', args[1]);
              await fetch(`http://${this.ipAddress}/api/images/display`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ FileName: args[1] })
              });
              break;
            case 'TL':
              console.log('Transitioning LED:', args[1], args[2], args[3], args[4], args[5], args[6]);
              await fetch(`http://${this.ipAddress}/api/led/transition`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  Red: parseInt(args[1]), Green: parseInt(args[2]), Blue: parseInt(args[3]),
                  Red2: parseInt(args[4]), Green2: parseInt(args[5]), Blue2: parseInt(args[6]),
                  TransitionType: args[7], TimeMS: parseInt(args[8])
                })
              });
              break;
            case 'MH':
              console.log('Moving Head:', args[1], args[2], args[3], args[4]);
              await fetch(`http://${this.ipAddress}/api/head`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  Roll: parseInt(args[1]), Pitch: parseInt(args[2]), Yaw: parseInt(args[3]), Velocity: parseInt(args[4])
                })
              });
              break;
            case 'MAS':
              await fetch(`http://${this.ipAddress}/api/arms/set`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  LeftArmPosition: parseInt(args[1]), LeftArmVelocity: parseInt(args[2]),
                  RightArmPosition: parseInt(args[3]), RightArmVelocity: parseInt(args[4])
                })
              });
              break;
          }
        }
      
        console.log('Behavior executed Successfullly:', behaviorName);
      };
}

