// Ambient declarations for untyped dependencies.

declare module "imapflow" {
  import { EventEmitter } from "events";

  interface ImapFlowOptions {
    host: string;
    port: number;
    secure?: boolean;
    auth: { user: string; pass: string };
    logger?: false | object;
    emitLogs?: boolean;
  }

  interface FetchQueryObject {
    uid?: boolean;
    envelope?: boolean;
    source?: boolean;
    bodyStructure?: boolean;
    flags?: boolean;
    internalDate?: boolean;
  }

  interface FetchMessageObject {
    uid: number;
    envelope?: {
      from?: Array<{ name?: string; address?: string }>;
      to?: Array<{ name?: string; address?: string }>;
      subject?: string;
      date?: Date;
      messageId?: string;
    };
    source?: Buffer;
    flags?: Set<string>;
    internalDate?: Date;
  }

  interface MailboxLock {
    release(): void;
  }

  class ImapFlow extends EventEmitter {
    constructor(options: ImapFlowOptions);
    connect(): Promise<void>;
    logout(): Promise<void>;
    close(): Promise<void>;
    getMailboxLock(mailbox: string): Promise<MailboxLock>;
    fetchOne(seq: string, query: FetchQueryObject, options?: { uid?: boolean }): Promise<FetchMessageObject>;
    fetch(range: string, query: FetchQueryObject, options?: { uid?: boolean }): AsyncIterable<FetchMessageObject>;
    search(query: object, options?: { uid?: boolean }): Promise<number[]>;
    idle(): Promise<boolean>;
    mailbox?: { exists?: number };
  }
}

declare module "mailparser" {
  import { Readable } from "stream";

  interface ParsedMail {
    messageId?: string;
    from?: { text?: string; value?: Array<{ name?: string; address?: string }> };
    to?: { text?: string; value?: Array<{ name?: string; address?: string }> };
    subject?: string;
    date?: Date;
    text?: string;
    html?: string | false;
    attachments?: Array<{ filename?: string; contentType?: string; size?: number }>;
  }

  function simpleParser(source: Buffer | Readable | string): Promise<ParsedMail>;
}
