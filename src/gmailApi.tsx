import fetch from "node-fetch";

import { OAuth } from "@raycast/api";
import { MessagesList, MessageListParams, Message, MessagePart, MessageParams, MessageBody, Confirmation, MessagePartBody, MessageIds, MessageData } from "./types"

// Bulk of Fetched Data
export async function fetchMessageMetadata (client: OAuth.PKCEClient, messagesList: MessageIds[], messageHeaders: Array<string>): Promise<MessageData[]> {
  const accessToken = (await client.getTokens())?.accessToken;
  const queryParams: MessageParams = {
    format: "metadata",
    metadataHeaders: messageHeaders
  }

  const params = new URLSearchParams();
  if (queryParams?.format) /* then */ params.append("format", `${queryParams?.format}`);
  if (queryParams?.metadataHeaders) /* then */ for (const header of queryParams?.metadataHeaders) { params.append("metadataHeaders", header) };

  
  const myPromises = messagesList.map(async (message) => {
    return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?`+ params.toString(), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    })
    .then((response) => response.json())
    .then(async (parsedJsonData) => {
      const fetchedMessage = parsedJsonData as Message

      try { fetchedMessage.payload.headers } catch (err) { console.log(fetchedMessage) }
      const fetchedHeaders = fetchedMessage.payload.headers
      const mappedHeaders = fetchedHeaders.map(header => ({[header.name]: header.value}));

      mappedHeaders.push({["MessageId"]: `${message.id}`});
      mappedHeaders.push({["ThreadId"]: `${message.threadId}`});
      mappedHeaders.push({["LabelIds"]: `${fetchedMessage.labelIds}`});
      mappedHeaders.push({["Snippet"]: `${fetchedMessage.snippet}`});

      const headerObject = Object.assign({}, ...mappedHeaders) // spread through each object in the source: "mappedHeaders" and assign them to the target which is initially an empty object {}

      const formattedDate = reformatDate(headerObject["Date"], "en-GB");
      const formattedTime = reformatTime(headerObject["Date"], "en-US");
      const completeDate = `${formattedDate} ${formattedTime}`

      headerObject["Date"] = completeDate;

      return headerObject ;
    })
  });

  return Promise.all(myPromises);
}

// Gmail API
export async function batchFetchPageData(client: OAuth.PKCEClient, fetchLimit: number, queryParams?: MessageListParams): Promise<MessagesList> {
  const fetchCap = fetchLimit; // Set the message fetchCap to the fetchLimit

  let fetchPerRequest = 500; // Number of messages to ask for per http request, gmail has a cap at 500
  if (queryParams?.maxResults) fetchPerRequest = queryParams.maxResults;

  let nextPageToken = ""; // The next page token
  if (queryParams?.pageToken) nextPageToken = queryParams.pageToken;

  const batchMessageIds: MessageIds[] = [];
  const messageIdsList: string[] = [];
  let pageReference;

  while (fetchLimit > 0) {
    // If the number of messages that will be fetched is > than the fetchcap - currentMessageCount, then set the new number of messages to be fetched to that difference
    if (fetchPerRequest >= (fetchCap - batchMessageIds.length)) fetchPerRequest = fetchCap - batchMessageIds.length;
    if (fetchPerRequest >= fetchLimit) fetchPerRequest = fetchLimit;
    // If we want to fetch more messages than the number of messages left to fetch then just fetch that limit instead
    
    const messageListParams: MessageListParams = { 
      maxResults: fetchPerRequest,
      pageToken: nextPageToken,
    }
    
    const fetchedMessageData: MessagesList = await fetchMessagesList(client, messageListParams);
    
    for (const messageIds of fetchedMessageData.messages) {
      // Push MessageIds if there isn't already a matching object in batchMessageIds
      if (!messageIdsList.includes(messageIds.id)) {
        batchMessageIds.push(messageIds);
        messageIdsList.push(messageIds.id)
      }
    }

    // If nextPageToken matches the first nextPageToken then break out of the loop
    if (pageReference == fetchedMessageData.nextPageToken) break;
    if (nextPageToken == "") pageReference = fetchedMessageData.nextPageToken;
    // Store the first nextPageToken as a pageReference to know when we started to loop back around

    nextPageToken = fetchedMessageData.nextPageToken;
    fetchLimit -= fetchPerRequest;
  }
  
  const batchMessagesList: MessagesList = ({
    messages: batchMessageIds,
    nextPageToken: nextPageToken,
    resultSizeEstimate: batchMessageIds.length
  })

  return batchMessagesList;
}

export async function fetchMessagesList(client: OAuth.PKCEClient, queryParams?: MessageListParams): Promise<MessagesList> {
  const accessToken = (await client.getTokens())?.accessToken
  const params = new URLSearchParams();
  
  (queryParams?.maxResults) ? params.append("maxResults", `${queryParams?.maxResults}`) : "";
  (queryParams?.pageToken) ? params.append("pageToken", queryParams?.pageToken) : "";
  (queryParams?.query) ? params.append("q", queryParams?.query) : "";
  if (queryParams?.labelIds) /* then */ for (const labelId of queryParams?.labelIds) { params.append("labelIds", labelId) }
  (queryParams?.includeSpamTrash) ? params.append("includeSpamTrash", `${queryParams?.includeSpamTrash}`) : "";
  
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?` + params.toString(), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!response.ok) {
    console.error("FetchMessagesList Error:", await response.text());
    throw new Error(response.statusText);
  }
  
  return await response.json() as MessagesList;
}

export async function fetchMessagesListHeaders (client: OAuth.PKCEClient, messagesList: MessageIds[], messageHeaders: Array<string>): Promise<MessageData[]> {
  const accessToken = (await client.getTokens())?.accessToken
  const queryParams: MessageParams = {
    format: "metadata",
    metadataHeaders: messageHeaders
  }

  const params = new URLSearchParams();
  if (queryParams?.format) /* then */ params.append("format", `${queryParams?.format}`);
  if (queryParams?.metadataHeaders) /* then */ for (const header of queryParams?.metadataHeaders) { params.append("metadataHeaders", header) };

  
  const myPromises = messagesList.map((message) => {
    return fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${message.id}?`+ params.toString(), {
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
    })
    .then((response) => response.json())
    .then((parsedJsonData) => {
      const fetchedMessage = parsedJsonData as Message

      try { fetchedMessage.payload.headers } catch (err) { console.log(fetchedMessage) }
      const fetchedHeaders = fetchedMessage.payload.headers

      // Unmapped -> [ { name: "content", value: "content" }, { name: "content", value: "content" }, { name: "content", value: "content" },]
      // Mapped -> [ { header.name: "header.value" }, { header.name: "header.value" }, { header.name: "header.value" } ]
      const mappedHeaders = fetchedHeaders.map(header => (
        {[header.name]: header.value}
        //The square brackets [] in [header.name] are used to create a computed property in the object. 
        // This means the property name will be computed by evaluating the expression header.name, instead of using the literal string between the brackets. 
      ));
      mappedHeaders.push({["MessageId"]: `${message.id}`})

      const headerObject = Object.assign({}, ...mappedHeaders) // spread through each object in the source: "mappedHeaders" and assign them to the target which is initially an empty object {}

      const formattedDate = reformatDate(headerObject["Date"], "en-GB");
      const formattedTime = reformatTime(headerObject["Date"], "en-US");
      const completeDate = `${formattedDate} ${formattedTime}`

      headerObject["Date"] = completeDate;

      return headerObject ;
    })
  });

  return Promise.all(myPromises);
}

export async function fetchTrashedMessagesList(client: OAuth.PKCEClient) {
  const messageListParams: MessageListParams = {
    labelIds: ["TRASH"]
  }

  const trashedMessageList = await fetchMessagesList(client, messageListParams)
  return trashedMessageList
}

export async function fetchMessage(client: OAuth.PKCEClient, messageId: string, queryParams?: MessageParams): Promise<Message> {
  const accessToken = ( await client.getTokens() )?.accessToken
  const params = new URLSearchParams();

  if (queryParams?.format) /* then */ params.append("format", `${queryParams?.format}`);
  if (queryParams?.metadataHeaders) /* then */ for (const header of queryParams?.metadataHeaders) { params.append("metadataHeaders", header) };

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?` + params.toString(), {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const message = await response.json() as Message;

  return message;
}

export async function fetchAttachment(client: OAuth.PKCEClient, messageId: string, attachmentId: string): Promise<MessagePartBody> {
  const accessToken = (await client.getTokens())?.accessToken

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}?`, {
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  const parsedJson = await response.json() as MessagePartBody

  return parsedJson
}

export async function fetchMessageRaw(client: OAuth.PKCEClient, messageId: string): Promise<string> {
  const messageParams: MessageParams = {
    format: "raw"
  }

  const message = await fetchMessage(client, messageId, messageParams);
  const encodedRawMessage = message.raw;
  const rawMessage = decodeBase64Str(encodedRawMessage)

  return rawMessage;
}

export async function fetchMessageSnippet(client: OAuth.PKCEClient, messageId: string): Promise<string> {
  const messageSnippet = await fetchMessage(client, messageId);
  return messageSnippet.snippet // return message snippet which is found in the messageContent
}

export async function fetchMessageBody(client: OAuth.PKCEClient, messageId: string, contentType?: string): Promise<string> {

  const message = await fetchMessage(client, messageId);
  if (!contentType) contentType = "text/plain"
  
  // If there is no payload then there was an error fetching the message
  try { message.payload.body.size } 
  catch (error) { 
    let errorMessage = `${error}`;

    errorMessage = "FetchMsgBody Error: " + errorMessage + "\nResponse Result: " + JSON.stringify(message);
    console.log(errorMessage)

    return errorMessage
  }
  
  // code to extract, decode and return message html
  if (message.payload.body.size != 0) return decodeBase64Str(message.payload.body.data);  // return message body b/c no parts

  try {
    const payloadPart = await getPayloadParts(message.payload, contentType);
    return decodeBase64Str(payloadPart[0].data);                                          // return message body in part
  } catch(err) {
    return "(No Message Body)";                                                        // return empty message b/c no body
  }                            
  
}

export async function sendMessageBody(client: OAuth.PKCEClient, opts: MessageBody): Promise<Confirmation> {
  const accessToken = (await client.getTokens())?.accessToken
  const messageOptions = [
    `From: ${opts.senderName ? opts.senderName : ""} <${opts.senderEmail ? opts.senderEmail : ""}>`,
    `To: ${opts.recipientName ? opts.recipientName : ""} <${opts.recipientEmail}>`,
    `Content-Type: ${opts.contentType ? opts.contentType : 'text/html'};`,
    `Subject: ${opts.subject ? opts.subject : ""}`,
    ``,
    `${opts.body ? opts.body : ""}`,
  ];
  const messageBody = messageOptions.join('\n');                // Combine the message parts into a single string seperated by new lines
  const encodedMessage = encodeURLBase64(messageBody);         // encode message into a url safe base64 format
  const rawJSON = JSON.stringify({ "raw" : encodedMessage });  // Convert to JSON string for post method body

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/send`, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
    body: rawJSON
  });
  const sentMessage = await response.json() as Confirmation;

  return sentMessage;
}

export async function trashMessage(client: OAuth.PKCEClient, messageId: string): Promise<object> { // I would like this to be of type Confirmation but it says it has missing properties, but it's not
  
  const accessToken = (await client.getTokens())?.accessToken
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/trash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const deletedMessage = response.json() as object;

  return deletedMessage;
}

export async function untrashMessage(client: OAuth.PKCEClient, messageId: string): Promise<object> { // I would like this to be of type Confirmation or Message but it says it has missing properties, but it's not
  const accessToken = (await client.getTokens())?.accessToken

  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/untrash`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` }
  });
  const recoveredMessage = response.json() as object;

  return recoveredMessage;
}

//Functions needed for the gmailApi file
export function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export function decodeBase64Str(base64: string): string {
  if (typeof base64 === 'string') {
    const binary = Buffer.from(base64, 'base64'); // Ta-da
    const ascii = binary.toString('utf-8');
    return ascii;
  }
  else return "Empty"
}

function encodeURLBase64(ascii: string): string {
  const base64UrlEncoded = Buffer.from(ascii)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  return base64UrlEncoded;
}

export function reformatDate(dateStr: string, locale?: string, formatting?: object) {
  const event = new Date(dateStr);

  if (!formatting) formatting = { weekday: "long", day: "2-digit", month: "short", year: "numeric" };
  const date = event.toLocaleDateString( locale, formatting )

  return date; // My preferred date locale is "en-GB"
}

export function reformatTime(timeStr: string, locale?: string, formatting?: object) {
  const event = new Date(timeStr);

  if (!formatting) formatting = { hour: "numeric", minute: "numeric" }
  const time = event.toLocaleTimeString(locale, formatting);

  return time; // My preferred time locale is "en-US"
}

async function getPayloadParts(messagePayload: MessagePart, mimeType: string, partsArray?: MessagePartBody[]): Promise<MessagePartBody[]> {  
  const payloadParts: MessagePart[] = messagePayload.parts;

  // if there isn't an already preconstructed parts array then create one
  if (!partsArray) partsArray = [] as MessagePartBody[];
  
  for (const part of payloadParts) {
    // mimeTypes include: text/html... text/plain... image/ ... pdf/ ...
    if (part.mimeType.includes(mimeType)) partsArray.push(part.body);

    // If there are any more parts, run the function again, else return the partsArray
    if (part.parts) getPayloadParts(part, mimeType, partsArray)
  }

  return partsArray
}