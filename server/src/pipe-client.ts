import net from "node:net";
import { EventEmitter } from "node:events";
import type {
  IpcClientMessage,
  IpcServerMessage,
  Question,
} from "./types.js";
import { logger } from "./logger.js";

export class PipeClient extends EventEmitter {
  private socket: net.Socket | null = null;
  private buffer = "";
  private _connected = false;

  get connected(): boolean {
    return this._connected;
  }

  connect(pipePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(pipePath, () => {
        this._connected = true;
        this.socket = socket;
        logger.info(`Connected to pipe: ${pipePath}`);
        resolve();
      });

      socket.on("data", (data: Buffer) => {
        this.buffer += data.toString("utf-8");
        this.processBuffer();
      });

      socket.on("error", (err) => {
        if (!this._connected) {
          reject(err);
        } else {
          logger.error(`Pipe error: ${err.message}`);
          this.emit("error", err);
        }
      });

      socket.on("close", () => {
        this._connected = false;
        this.socket = null;
        logger.info("Pipe disconnected");
        this.emit("disconnected");
      });
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      try {
        const message = JSON.parse(trimmed) as IpcServerMessage;
        this.handleMessage(message);
      } catch (err) {
        logger.error(`Failed to parse pipe message: ${trimmed}`);
      }
    }
  }

  private handleMessage(message: IpcServerMessage): void {
    switch (message.type) {
      case "answer":
        this.emit("answer", message.questionId, message.answer);
        break;
      case "denied":
        this.emit("denied", message.questionIds, message.reason);
        break;
      default:
        logger.warn(`Unknown message type: ${(message as { type: string }).type}`);
    }
  }

  send(message: IpcClientMessage): void {
    if (!this.socket || !this._connected) {
      logger.error("Cannot send: pipe not connected");
      return;
    }

    const json = JSON.stringify(message) + "\n";
    this.socket.write(json);
  }

  sendQuestion(question: Question, sessionName: string, sessionCwd: string): void {
    this.send({
      type: "new_question",
      question,
      sessionName,
      sessionCwd,
    });
  }

  sendQuestionsBatch(
    questions: Question[],
    sessionName: string,
    sessionCwd: string
  ): void {
    this.send({
      type: "new_questions_batch",
      questions,
      sessionName,
      sessionCwd,
    });
  }

  sendDismiss(questionIds: string[], reason?: string): void {
    this.send({
      type: "dismiss_questions",
      questionIds,
      reason,
    });
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
      this._connected = false;
    }
  }
}
