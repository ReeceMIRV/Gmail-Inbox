export interface FilePath {
    Directory: string,
    DirecFolder: string,
    FilePath: string,
    FileName: string,
    FileUUID: string,
    FileExtension: string
}

export interface UserReference {
    currentUser: {
      alias: string,
      fetchMail: boolean
    }
    nextUser: {
      alias: string,
      fetchMail: boolean
    }
}

export interface MessageData {
    From: string,
    To: string
    Subject: string,
    Date: string,
    MessageId: string,
    ThreadId: string,
    LabelIds: string,
    Snippet: string,
}

export interface MessageBody {
    senderName?: string,
    senderEmail?: string,
    recipientName?: string,
    recipientEmail: string,
    subject?: string,
    contentType?: string,
    body?: string,
}

export interface Confirmation {
    id?: string,
    threadId?: string,
    labelIds?: [
        string
    ],
    error?: object
}

export interface MessageIds {
    id: string,
    threadId?: string,
}

// https://developers.google.com/gmail/api/reference/rest/v1/users.messages/list
export interface MessagesList {
    messages: MessageIds[]
    nextPageToken: string,
    resultSizeEstimate: number,
}

// https://developers.google.com/gmail/api/reference/rest/v1/users.messages/list
export interface MessageListParams {
    maxResults?: number,
    pageToken?: string,
    query?: string,
    labelIds?: string[],
    includeSpamTrash?: boolean
}

// https://developers.google.com/gmail/api/reference/rest/v1/users.messages
export interface Message {
    id: string,
    threadId: string,
    labelIds: string[],
    snippet: string,
    historyId: string,
    internalDate: string,
    payload: MessagePart, // Object
    sizeEstimate: number,
    raw: string
}

export interface MessageParams {
    // Eg. Minimal, Full, Raw, Metadata
    format?: string,
    metadataHeaders?: string[]
}

// https://developers.google.com/gmail/api/reference/rest/v1/users.messages#Message.MessagePart
export interface MessagePart {
    partId: string,
    mimeType: string,
    filename: string,
    headers: Header[], // Object
    body: MessagePartBody, // Object
    parts: MessagePart[] // Object
}

// https://developers.google.com/gmail/api/reference/rest/v1/users.messages#Message.Header
export interface Header {
    name: string,
    value: string
}

// https://developers.google.com/gmail/api/reference/rest/v1/users.messages.attachments#MessagePartBody
export interface MessagePartBody {
    attachmentId?: string,
    size: number,
    data: string
}

// https://developers.google.com/identity/openid-connect/openid-connect#python
export interface IdToken {
    iss: string,
    azp: string,
    aud: string,
    sub: string,
    at_hash: string,
    hd: string,
    email: string,
    email_verified: boolean,
    iat: number,
    exp: number,
    nonce: string
}