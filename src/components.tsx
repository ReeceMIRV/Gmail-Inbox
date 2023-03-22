import { Form, ActionPanel, Action, List, Toast, showToast, OAuth, Icon, Cache, useNavigation, Detail, LocalStorage, popToRoot, showHUD, confirmAlert, Alert, open } from "@raycast/api";
import { useEffect, useState, Fragment } from "react";
import jwtDecode from 'jwt-decode';

import { MessageData, MessageListParams, MessagesList, MessageIds, IdToken, MessageBody, Confirmation, FilePath } from "./types";
import { deleteFolder, directoryExists, getFilePathString, writeNewFile, showInQuicklookShell } from "./tempFiles";
import * as oauth from "./oauth";
import * as gmail from "./gmailApi";

const EXTENSION_CACHE = new Cache();

// The number of message headers to fetch in a promiseAll
const HEADER_BATCH_PROMISE = 100;
const FETCH_SPEED_MS = 10;
const MSGIDS_FETCH_PER_REQUEST = 100;

const TEMP_FILE_LIMIT = 100;
const FETCH_LIMIT_PG = 100;

const EMPTY_MESSAGE_DATA: MessageData = {
    Date: "",
    From: "",
    To: "",
    Subject: "",
    Snippet: "",
    MessageId: "",
    ThreadId: "",
    LabelIds: ""
}

//cache path: /Users/user/Library/Application Support/com.raycast.macos/extensions/gmail-inbox/com.raycast.api.cache/
//const TEMP_FILE_DIRECTORY = tmpdir(); // Temp Folder Path Using tmpdir() : '/var/folders/.../.../T'
const TEMP_FILE_DIRECTORY = EXTENSION_CACHE.storageDirectory

const TEMP_FILE_PATH: FilePath = {
    Directory: TEMP_FILE_DIRECTORY,
    DirecFolder: "/htmlTempFiles",
    FilePath: "",
    FileName: "/quicklook-",
    FileUUID: "",
    FileExtension: ".html"
}

export function PrimaryScreen(props:{userAlias: string}): JSX.Element {
    // Return a component while user credentials are being fetched (this component is only seen for a split of a split second)
    // The majority of the loading screen time is actually taken up by the MessageHeadersList loading component
    if (props.userAlias == "") return <Detail isLoading={true}/>

    //const generatedClient = new (oauth.generateClient as any)("myAlias")
    // I want to somehow move this to my oauth file w/o any errors
    const constructedClient = new OAuth.PKCEClient ({
        redirectMethod: OAuth.RedirectMethod.AppURI,
        providerName: `Gmail`,
        providerIcon: `gmail-icon.png`,
        providerId: `${props.userAlias}`,
        description: `Connect your Gmail account using Raycast!`,
    });
    
    return <MessageDataList client={constructedClient} />;
}

export function MessageDataList(props: {client: OAuth.PKCEClient}): JSX.Element {
    const [client, setClient] = useState<OAuth.PKCEClient>(props.client);

    const [messageIdsList, setMessageIdsList] = useState<MessageIds[]>([]);
    const [messageData, setMessageData] = useState<MessageData[]>([]);

    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [identifier, setIdentifier] = useState("");
    const [isOffline, setIsOffline] = useState("Online");
    
    const [showRaycastQuicklook, setShowRaycastQuicklook] = useState<boolean>(false);
    const [storeCache, setstoreCache] = useState<boolean>();
    const [isFetching, setIsFetching] = useState<boolean>(true)

    const [currentPage, setCurrentPage] = useState<number>(0);
    const [pageTokenList, setPageTokenList] = useState<Array<string>>([""]);

    function viewPrevPage() {
        if (currentPage > 0) setCurrentPage(currentPage - 1);
        else {
            showToast({ title: "Note: ", message: "End of Navigation Left" })
            return
        }

        setMessageData([]);
        setIsLoading(true);
    }
    async function batchMakeNewFiles(client: OAuth.PKCEClient, messageDataList: MessageData[]): Promise<void> {
        for (const messageDataItem of messageDataList) {
            writeNewTempHtmlFile(client, messageDataItem.MessageId);
            await gmail.sleep(1); // Sleep between file creations or else risk failure of missing one
        }
    }

    async function writeNewTempHtmlFile(client: OAuth.PKCEClient, selectionId: string): Promise<void> {
        // Fetch Message Body, Create A HTML Doc for it, Store it in the Temporary Files Directory, & Update The QuickLook File Path
        const messageBody = await gmail.fetchMessageBody(client, selectionId, "text/html");
        TEMP_FILE_PATH.FilePath = `/${client.providerId}/page-${currentPage}`
        TEMP_FILE_PATH.FileUUID = selectionId

        await writeNewFile(TEMP_FILE_PATH, messageBody);

        if (messageBody.startsWith("Failure: ")) { showToast({ style: Toast.Style.Failure, title: "MsgListFetchError: ", message: String(messageBody) }) }
    }

    function viewNextPage() {
        if (pageTokenList.length >= currentPage + 2) setCurrentPage(currentPage + 1);
        else {
            showToast({ title: "Note: ", message: "End of Navigation Right" })
            return
        }

        setMessageData([]);
        setIsLoading(true);
    }

    useEffect(() => {
        (async () => {
            try {
                // Get temp file folder path on session startup & set it to global scoped Temp_File_Path
                //TEMP_FILE_PATH.Path = "/private/var/folders/j_/0s6y1_j55bv2j5889pk_dwcc0000gn/T/TemporaryItems/"

                // authenticate or get authentication credentials, & try to fetch, display messages
                try { await oauth.authenticate(client) } 
                catch (error) {
                    console.log("Failed to Authorize User" + String(error));
                    showToast({ style: Toast.Style.Failure, title: "Authorization Error: ", message: String(error) });
                }

                const storageData = await LocalStorage.allItems()
                const tempFileLimit = JSON.parse(storageData.tempFileLimit);
                const fetchLimit = JSON.parse(storageData.fetchLimit);
                const fetchSpeed = JSON.parse(storageData.fetchSpeed);
                const storeCache = JSON.parse(storageData.storeCache);

                setstoreCache(storeCache);
                
                const messageListParams: MessageListParams = { 
                    maxResults: MSGIDS_FETCH_PER_REQUEST,
                    pageToken: pageTokenList[currentPage],
                }

                // Fetch the Message Id & Thread Id Lists
                const pageData: MessagesList = await gmail.batchFetchPageData(client, fetchLimit, messageListParams);
                const fetchedMessageIdsList = pageData.messages.map((message) => ({ id: message.id, threadId: message.threadId }));
                setMessageIdsList([...fetchedMessageIdsList]);

                // If pageToken is already in the array then don't add it to the list
                // If there is no page token (token is undefined) then don't add it to the list
                // Add next token that meets these conditions so it's the next element of the array
                if (!pageTokenList.includes(pageData.nextPageToken) && pageData.nextPageToken != undefined) {
                    setPageTokenList([...pageTokenList, pageData.nextPageToken]);
                }
                
                const messageDataList: MessageData[] = [];

                while(fetchedMessageIdsList.length > 0) {
                    
                    const messageIdsListPortion = fetchedMessageIdsList.slice(0, HEADER_BATCH_PROMISE); // Slice (get) the first (variable) elements from the messagesList array
                    fetchedMessageIdsList.splice(0, HEADER_BATCH_PROMISE) // Splice (delete) those (variable) elements from the messagesList array
                    
                    try {
                        const fetchedMessageDataList: MessageData[] = await gmail.fetchMessageMetadata(client, messageIdsListPortion, ["To", "From", "Subject", "Date"]);
                        messageDataList.push(...fetchedMessageDataList);
                    } catch (error) {
                        console.log("FetchMessageDataListError: " + String(error));
                        showToast({ style: Toast.Style.Failure, title: "FetchMessageDataListError: ", message: String(error) });
                    }

                    // setMessageData ([{"From": "I Am From", "Subject": "I Am Subject", "Date": "I Am Date", "MessageId": "I Am Unique"} as MsgHeaders] + [fetchedHeadersChunk])
                    setMessageData([...messageDataList]);
                    await gmail.sleep(fetchSpeed); // We need to send message http requests in portions or else we'll cause a resource exhaust error from too many requests being sent in at once
                }
                if (storeCache && pageTokenList[currentPage] == "") EXTENSION_CACHE.set(`MessageData-${client.providerId}`, JSON.stringify(messageDataList)); // If storeCache is truthy then store NON queried messages for offline use
                if (!storeCache && !EXTENSION_CACHE.isEmpty) EXTENSION_CACHE.clear(); // If storeCache is false & EXTENSION_CACHE is NOT empty then clear it

                const jwtEncodedIdToken = await oauth.getIdToken(client) as string;
                const idToken: IdToken = jwtDecode(jwtEncodedIdToken);

                setIdentifier(idToken.email);

                // showRaycastQuicklook if the number of fetchedMsges is <= the number of tempFiles to store
                // Otherwise we don't want to store them because this will lead to only some of the messages being stored for quicklook
                if (messageDataList.length <= tempFileLimit) setShowRaycastQuicklook(true);
                
                // Once We've Fetched A Full List of the MessageData, then send another set of batch requests to get the body
                // If we're caching data, and fetchedMessages Is Less than the tempFileLimit, then create html quick look files (store temp files)
                if (storeCache && messageDataList.length <= tempFileLimit) {
                    batchMakeNewFiles(client, messageDataList)
                    
                    .then(async() => { 
                        setIsLoading(false);
                        setIsFetching(false);
                        
                        console.log("Promise End (Batch Make Files)");
                        //showToast({ title: "Success: ", message: `Cached Quicklook Files \\ Page: ${currentPage + 1}`})
                    })
                    .catch((error) => { 
                        showToast({ title: "CacheFailure: ", message: `Failed to cache quicklook files \\ Page: ${currentPage + 1} + ${error}`, style: Toast.Style.Failure })
                        console.log(`Failed to cache quicklook files \\ Page: ${currentPage + 1} ${error}`);
                    })
                }
                else {
                    setIsLoading(false);
                    setIsFetching(false);
                }

            } catch (error) {
                let errorMessage;
                if (error instanceof Error) errorMessage = `${error}`;
                console.log(errorMessage)

                showToast({ style: Toast.Style.Failure, title: "FetchError: ", message: String(error) });
                setIsOffline("Offline")
                setIsLoading(false);

                // Use cached messages when fetch error fails and user is offline
                const messageDataList = EXTENSION_CACHE.get(`MessageData-${client.providerId}`);
                if (messageDataList) setMessageData(JSON.parse(messageDataList));
            }

        })(); // <- Self Execution -- (myFunction)()
    }, [client, currentPage]); // <- If [], run once when the function loads

    return (
        <List 
            isLoading={isLoading} 
            navigationTitle={`Gmail Inbox - ${isOffline} \\ Page: ${currentPage + 1}`}
            searchBarPlaceholder="Search"
            actions={
                <ActionPanel>
                    <ActionManagePreferences isOffline={isOffline} />
                    <DebugSubmenu />
                </ActionPanel>
            }
            searchBarAccessory={
                <List.Dropdown 
                    tooltip="User Dropdown"
                    onChange={async (userSelection) => {
                        // Switch Clients if user selected a dropdown item that != the currently active one

                        if (!userSelection.startsWith("active")) {

                            // Set a new client which auto rerenders the page
                            const userClient = new OAuth.PKCEClient ({
                                redirectMethod: OAuth.RedirectMethod.AppURI,
                                providerName: `Gmail`,
                                providerIcon: `gmail-icon.png`,
                                providerId: `${userSelection}`,
                                description: `Connect your Gmail account using Raycast!`,
                            });

                            const userRefs = await oauth.getUserReferences()

                            if (userRefs) {
                                await oauth.setUserInactive(userRefs.currentUser.alias);
                                await oauth.setUserActive(userSelection);
                            }
                            //showToast({title: "Switching", message: `Switching to User "${userClient.providerId}"`, style: Toast.Style.Animated});
                            //showToast({title: "Success", message: `Switched to User "${userClient.providerId}"`});
                            setIsLoading(true);
                            setCurrentPage(0);
                            setMessageData([]);
                            setClient(userClient);
                        }
                    }}
                >
                    <List.Dropdown.Item title={`Active User: ${client.providerId}`} key={`active-${client.providerId}`} value={`active-${client.providerId}` } />
                    <UserSearchBarSectionAccessory />
                </List.Dropdown>
            }
            isShowingDetail
        >
            {
                messageData.map((messageData, index) => {
                    return (
                        <List.Item
                            key={messageData.MessageId} 
                            id={messageData.MessageId} 
                            icon={Icon.Envelope}
                            title={messageData.Subject ? messageData.Subject : "(No Subject)"}
                            quickLook={{name: "Quicklook Message", path: getFilePathString(TEMP_FILE_PATH, {newFilePath: `/${client.providerId}/page-${currentPage}`, newFileUUID: messageData.MessageId}) }}
                            actions={
                                <ActionPanel>
                                    <PrimaryActions 
                                        client={client} 
                                        messageIdsList={messageIdsList} 
                                        messageData={messageData} identifier={identifier} 
                                        isOffline={isOffline}
                                        isFetching={isFetching}
                                        showRaycastQuicklook={showRaycastQuicklook}
                                        storeCache={storeCache}
                                        prevPage={ () => viewPrevPage() } 
                                        currentPage={currentPage}
                                        nextPage={ () => viewNextPage() } 
                                    />
                                </ActionPanel>
                            }
                            detail={
                                <List.Item.Detail 
                                    //markdown="![Illustration](https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/25.png)"
                                    markdown={`${messageData.Subject} \n\n---\n ${messageData.Snippet}`}
                                    metadata={
                                        <List.Item.Detail.Metadata>
                                                <List.Item.Detail.Metadata.Label title="From: " text={messageData.From} />
                                                <List.Item.Detail.Metadata.Separator/>
                                                <List.Item.Detail.Metadata.Label title="To: " text={messageData.To}/>
                                                <List.Item.Detail.Metadata.Separator/>
                                                <List.Item.Detail.Metadata.Label title="Date: " text={messageData.Date}/>
                                                <List.Item.Detail.Metadata.Label title="Categories:" text={"#" + messageData.LabelIds.replaceAll(',',' #').toLowerCase()} />
                                                <List.Item.Detail.Metadata.Separator/>

                                                <List.Item.Detail.Metadata.Label title="Message Index:" text={`${index}`} />
                                                <List.Item.Detail.Metadata.Label title="Message Identifier:" text={`${messageData.MessageId}`} />
                                                <List.Item.Detail.Metadata.Label title="Thread Identifier:" text={`${messageData.ThreadId}`} />
                                                <List.Item.Detail.Metadata.Separator/>
                                                {/*<List.Item.Detail.Metadata.Link title="Temp File Path:" text={`~/T/Gmail-Inbox-Extension`} target={`file://${TEMP_FILE_DIRECTORY + TEMP_FILE_PATH.DirecFolder}`} />*/}
                                                
                                        </List.Item.Detail.Metadata>
                                    }
                                />
                            }
                            keywords={[
                                `Subject: ${messageData.Subject}`,
                                `Snippet: ${messageData.Snippet}`,
                                `From: ${messageData.From}`,
                                `To: ${messageData.To}`,

                                `Date: ${gmail.reformatDate(messageData.Date, "en-GB")}`,

                                `Weekday: ${gmail.reformatDate(messageData.Date, "en-GB", {weekday: "long"} )}`,
                                `Day: ${gmail.reformatDate(messageData.Date, "en-GB", {day: "2-digit"} )}`,
                                `Month: ${gmail.reformatDate(messageData.Date, "en-GB", {month: "long"} )}`,
                                `Year: ${gmail.reformatDate(messageData.Date, "en-GB", {year: "numeric"} )}`,

                                `Time: ${gmail.reformatTime(messageData.Date, "en-US")}`,

                                `Categories: ${"#" + messageData.LabelIds.replaceAll(',',' #').toLowerCase()}`,
                                `Message Index: ${index}`,

                                `Message Identifier: ${messageData.MessageId}`,
                                `${messageData.MessageId}`,
                                `Thread Identifier: ${messageData.ThreadId}`,
                                `${messageData.ThreadId}`,
                            ]}
                        />
                    )
                })
            }
        </List>
    )
}

export function MessageContent(props: {client: OAuth.PKCEClient; messageIdsList: MessageIds[]; messageId: string; identifier: string, relativity?: string }): JSX.Element {
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const [messageData, setMessageData] = useState<MessageData>(EMPTY_MESSAGE_DATA)
    const [newMessageId, setNewMessageId] = useState<string>(props.messageId)
    const [messageBody, setMessageBody] = useState<string>("")

    useEffect(() => {
        (async ()=> {
            const rawMsgBody = await gmail.fetchMessageBody(props.client, props.messageId);
            if (rawMsgBody == typeof Error) return
            const plainBody = stripHtml(rawMsgBody.toString());
            const newMsgBody = stripWhitespace(plainBody);
            const messageBody = cleanString(newMsgBody)

            // Find index of the current messageId
            const messageIndex = props.messageIdsList.findIndex((message) => props.messageId == message.id)
            let newMsgIndex: number = messageIndex;

            // Subtract/Add 1 to find the previous/next message's index
            // Validate that there actually is a next and previous msg
            // Set the new props.messageId to the relating index
            if (props.relativity == "PrevMsg") {
                let prevMsgIndex = messageIndex - 1;

                if (prevMsgIndex < 0) {
                    prevMsgIndex += 1;
                    showToast({ title: "Note: ", message: "End of Navigation Left" })
                }

                setNewMessageId(props.messageIdsList[prevMsgIndex].id)
                newMsgIndex = prevMsgIndex;
            } 
            if (props.relativity == "NxtMsg") {
                let nxtMsgIndex = messageIndex + 1;

                if (nxtMsgIndex > (props.messageIdsList.length - 2)) {
                    nxtMsgIndex -= 1;
                    showToast({ title: "Note: ", message: "End of Navigation Right" }) 
                }

                setNewMessageId(props.messageIdsList[nxtMsgIndex].id)
                newMsgIndex = nxtMsgIndex;
            }

            const prevMessageId: MessageIds[] = [{["id"]:`${props.messageIdsList[newMsgIndex].id}`}];
            const messageDataList: MessageData[] = await gmail.fetchMessageMetadata(props.client, prevMessageId, ["To", "From", "Subject", "Date"]);
            const messageData: MessageData = messageDataList[0];
            
            setMessageData(messageData)
            setMessageBody(messageBody);
            setIsLoading(false);
        })()
    }, [])

    return (
        <Detail
            navigationTitle={`Message Body - ${props.client.providerId}`}
            isLoading={isLoading}
            markdown={`### Subject: ${messageData.Subject} \n\n From: ${messageData.From} \n\n To: ${messageData.To} \n\n---\n ${messageBody} \n\n---\n > Date: ${messageData.Date} \n\n`}
            actions={
                <ActionPanel>
                    <PrimaryActions 
                        client={props.client} 
                        messageIdsList={props.messageIdsList} 
                        messageData={messageData} 
                        identifier={props.identifier} 
                        isOffline={""}
                        newMessageId={newMessageId} 
                        messageBody={messageBody} 
                    />
                </ActionPanel>
            }
        />
    )
}

export function ComposeForm(props: {client: OAuth.PKCEClient, messageData?: MessageData}) {
    const { pop } = useNavigation();
    
    return (
        <Form
            navigationTitle={`Compose Form - ${props.client.providerId}`}
            actions= {
                <ActionPanel>
                    <Action.SubmitForm onSubmit={ async (values) => {
                        const messageBody: MessageBody = {
                            recipientEmail: values.recipientEmail,
                            subject: values.subject,
                            body: values.body
                        }
                        showToast({title:"Sending Message", style: Toast.Style.Animated})
                        const response = await gmail.sendMessageBody(props.client, messageBody);
                        
                        if(response.id) {
                            showHUD("Message Sent!")
                            popToRoot()
                        } else {     
                            pop()
                            showToast({title:"Failure", message:`${JSON.stringify(response)}`, style:Toast.Style.Failure})
                        }
                    } } />
                </ActionPanel>
            }
        > 
            <Form.TextField placeholder="Recipient" id="recipientEmail" />
            <Form.TextField placeholder="Subject" id="subject" />
            <Form.TextArea placeholder="Message" id="body" />
        </Form>
    )
}


export function PreferencesForm(props: {isOffline: string}): JSX.Element {
    const [aliasListJSX, setAliasListJSX] = useState <JSX.Element[]>([]);
    const [aliasList, setAliasList] = useState([""]);
    const [aliasError, setAliasError] = useState<string | undefined>();

    const [tempFileLimit, setTempFileLimit] = useState("TempFileLimit");
    const [tempFileLimitError, setTempFileLimitError] = useState<string | undefined>()

    const [fetchLimit, setFetchLimit] = useState("FetchingLimit");
    const [fetchLimitError, setFetchLimitError] = useState<string | undefined>()

    const [fetchSpeed, setFetchSpeed] = useState("FetchingSpeed");
    const [speedError, setSpeedError] = useState<string | undefined>()

    const [cacheCheckboxJSX, setCacheCheckboxJSX] = useState<JSX.Element>();

    let AddAccountAliasField: JSX.Element = <Fragment></Fragment>;

    const newAddAccountAliasField = (
        <Form.TextField
            title={"New Account Alias"}
            info="Aliases are used to differentiate between accounts"
            placeholder="Enter an alias for your Account"
            error={aliasError}
            onChange={ (ev) => {
                setAliasError(""); // Remove Any Error Message
                
                // Add Error Message if Aliases are not unique
                for (const alias of aliasList) {
                    if (ev == alias) { setAliasError("Aliases must be unique") } 
                }
            }}
            id={"newAlias"}
        />

    )

    const FormDivider = (
        <Form.Description title="______________________" text="____________________________________________________________" />
    )

    if (props.isOffline.includes("Online")) AddAccountAliasField = newAddAccountAliasField;

    useEffect(() => {
        (async() => {

            const storageData = await LocalStorage.allItems();
            const userFormsJSX: JSX.Element[] = [];
            const aliasListArr: string[] = [];
            
            Object.entries(storageData).map( ([userKey, userValues]) => {
                const userValueObj = JSON.parse(userValues);

                if (userValueObj.user == true) {
                    aliasListArr.push(userKey);

                    return userFormsJSX.push(
                        <Form.Description
                            title="Account Alias"
                            text={userKey}
                            key={userKey} //JSX Key - Email-ID
                        />
                    )
                }
            });
            
            let storeCache: boolean;
            storageData.storeCache ? storeCache = JSON.parse(storageData.storeCache) : storeCache = true;

            const cacheCheckbox = (
                <Form.Checkbox
                    title=""
                    label="Store Cache? This allows for offline access & raycast quicklook"
                    defaultValue={storeCache}
                    id={"storeCache"}
                />
            )

            setAliasListJSX(userFormsJSX);
            setAliasList(aliasListArr);
            setCacheCheckboxJSX(cacheCheckbox);

            if (storageData.tempFileLimit) { setTempFileLimit(JSON.parse(storageData.tempFileLimit)) }
            else setTempFileLimit(`${TEMP_FILE_LIMIT}`)

            if (storageData.fetchLimit) { setFetchLimit(JSON.parse(storageData.fetchLimit)) }
            else setFetchLimit(`${FETCH_LIMIT_PG}`)

            if (storageData.fetchSpeed) { setFetchSpeed(JSON.parse(storageData.fetchSpeed)) }
            else setFetchSpeed(`${FETCH_SPEED_MS}`)

        })()
    }, []);

    return (
        <Form 
            navigationTitle={`Gmail Preferences`}
            actions= {
            <ActionPanel>
                <ActionPanel.Section title="Preferences Panel">
                    <Action.SubmitForm title="Update Preferences" icon={Icon.AddPerson} onSubmit={ async (userForm) => {
                        const storageData = await LocalStorage.allItems();

                        if (Object.keys(storageData).length !== 0 ) {
                            const storedTempFileLimit = JSON.parse(storageData.tempFileLimit);

                            // Delete currently stored temp files if stored temp file limit decreases
                            const tempFileDirectory = TEMP_FILE_PATH.Directory + TEMP_FILE_PATH.DirecFolder;
                            if (userForm.tempFileLimit < storedTempFileLimit) deleteFolder(tempFileDirectory);
                        }

                        LocalStorage.setItem( "tempFileLimit", JSON.stringify(userForm.tempFileLimit));
                        LocalStorage.setItem( "fetchLimit", JSON.stringify(userForm.fetchLimit));
                        LocalStorage.setItem( "fetchSpeed", JSON.stringify(userForm.fetchSpeed));
                        LocalStorage.setItem( "storeCache", JSON.stringify(userForm.storeCache));

                        if (userForm.newAlias) { // If there is a new alias then store it
                            const usersList = await oauth.getUsersList();

                            if (usersList.length == 0) { // Set fetchmail to true for first authenticated user
                                LocalStorage.setItem( `${userForm.newAlias}`, `{"user":true, "fetchMail":true}` );
                            }
                            else LocalStorage.setItem( `${userForm.newAlias}`, `{"user":true, "fetchMail":false}` );

                            const constructedClient = new OAuth.PKCEClient ({
                                redirectMethod: OAuth.RedirectMethod.AppURI,
                                providerName: `Gmail`,
                                providerIcon: `gmail-icon.png`,
                                providerId: `${userForm.newAlias}`,
                                description: `Connect your Gmail account using Raycast!`,
                            });
                            
                            // authenticate or get authentication credentials, & try to fetch, display messages
                            await oauth.authenticate(constructedClient);

                            //push(<MessageDataList client={constructedClient} />)
                            popToRoot() // Pop to root when a new user has been added
                            
                            await showToast({
                                title: "Success",
                                message: `User "${userForm.newAlias}" has been authenticated`,
                                style: Toast.Style.Success
                            })

                        } else {
                            popToRoot() // Pop to root to reload page
    
                            await showToast({
                                title: "Success",
                                message: `Preferences have been updated`,
                                style: Toast.Style.Success
                            })
                        }

                    }} />

                    <ActionRemoveAccountAliases />

                    <DebugSubmenu />
                </ActionPanel.Section>

            </ActionPanel>
        }>
            {aliasListJSX}

            {FormDivider}

            {AddAccountAliasField}

            {FormDivider}
            <Form.Description title={""} text={"Gmail Inbox Preferences"} />

            <Form.TextField
                title={"Fetching Speed (ms)"}
                value={fetchSpeed}
                error={speedError}
                onChange={ 
                    (ev) => {
                        if (ev == "FetchingSpeed") return // ignore any events that occur while fetching the limit found in local storage
                        setFetchSpeed(ev)

                        parseInt(ev) ? setSpeedError("") : setSpeedError("Speed must be an integer");
                    }}
                placeholder={`${FETCH_SPEED_MS}`}
                info="The speed at which messages are fetched."
                id={"fetchSpeed"}
            />

            <Form.TextField
                title={"Message Fetch Limit"}
                value={fetchLimit}
                error={fetchLimitError}
                onChange={ 
                    (ev) => {
                        if (ev == "FetchingLimit") return // ignore any events that occur while fetching the limit found in local storage
                        setFetchLimit(ev)

                        parseInt(ev) ? setFetchLimitError("") : setFetchLimitError("Limit must be an integer");
                    }}
                placeholder={`${FETCH_LIMIT_PG}`}
                info="The number of messages fetched per page."
                id={"fetchLimit"}
            />

            <Form.TextField
                title={"Temporary File Limit"}
                value={tempFileLimit}
                error={tempFileLimitError}
                onChange={ 
                    (ev) => {
                        if (ev == "TempFileLimit") return // ignore any events that occur while fetching the limit found in local storage
                        setTempFileLimit(ev)

                        parseInt(ev) ? setTempFileLimitError("") : setTempFileLimitError("Limit must be an integer");
                    }}
                placeholder={`${TEMP_FILE_LIMIT}`}
                info="The number of messages that are stored in cache/tempFiles for offline use & raycast quicklook."
                id={"tempFileLimit"}
            />
            {cacheCheckboxJSX}

            <Form.Description title="______________________" text="____________________________________________________________" />
            <Form.Description title={""} text={"Understanding Preferences"} />
            <Form.Description title={"Fetch Limit Notes:"} text={"Messages are fetched everytime you change pages. Each page will contain a count of messages equal to the fetch limit. Setting this too high will most likely cause errors. These errors would occur because of fetch quota limits per minute which are set by gmail's api, so avoid excessively high numbers. An excessively high number may also cause an excess in memory usage, which could lead to an error. So don't set this too high!"} />
            <Form.Description title={"Fetch Speed Notes:"} text={"Higher fetch limits may require a slower fetch speed in order to avoid fetch quota limit errors. The problem is that this would lead to slower processing time in addition to possible errors if mishandled."} />
            <Form.Description title={"Temporary File Limit:"} text={"If the Message Fetch Limit is greater than the Temporary File Limit then the Raycast Quicklook Command will be turned off and the Shell Quicklook Command will be used instead. This is due to the fact that Raycast requires for the temporary files to exist prior toward running their custom quicklook command. This means that all the temporary files need to be created on extension loadup. That is why the temporary file limit cannot exceed the fetch limit in order to use that action. Don't fret though! The View Using Quicklook Shell command will automatically be put in it's place if you so choose to have a lower temp file limit than message fetch limit."} />
            <Form.Description title={"Cache Data Boolean:"} text={"Cache is used to both store your fetched messages and temporary files, so turning this off will disable any offline access you may so desire. In addition to this fact, you won't be able to use Raycast's Quicklook action even when online. This is due to the need for the temporary needing to exist prior toward using Raycasts Quicklook action which is not possible without without storing temporary files. This is due to the fact that there would be no way of knowing when to delete them. As mentioned previously though, there is no need to fret! And this is because you will still be able to quicklook messages via the View using Shell command which will automatically be set as the primary action when cache is off!"} />
            <Form.Description title={"Switching Pages:"} text={"As previously mentioned, there is a quota limit on gmail's api, and just simply rendering a page needs multiple calls for each individual header, so switching between pages too quickly will most likely cause a quota limit error and components will no longer display. If this happens and no items are loaded, quicklook isn't functioning, or the navigation bar says \"offline,\" but you're currently online, then just wait around a minute and then reopen the extension."} />
            <Form.Description title={"Final Verdict: "}text={"Yes, these settings do exist, and they exist for a reason! It adds custom control for each user, BUT if they are mishandled they can lead to an excess of errors. So avoid overloading the extension with unreasonable limits!"} />

        </Form>
    )
}

export function UserSearchBarSectionAccessory(): JSX.Element {
    const [DropDownItems, setDropDownItems] = useState<JSX.Element[]>();

    useEffect(() => {
        (async() => {
            const usersList = await oauth.getUsersList()

            const DropDownItemsResponse: JSX.Element[] = usersList.map((user) => {
                const userObject = JSON.parse(user);
                const userAlias = userObject.alias;

                return <List.Dropdown.Item title={`${userAlias}`} key={`${userAlias}`} value={`${userAlias}`} />
            })

            if (DropDownItemsResponse != undefined) setDropDownItems(DropDownItemsResponse);
        })()
    },[])

    return (
        <List.Dropdown.Section title="User Aliases">
            {DropDownItems}
        </List.Dropdown.Section>
    )
}

export function PrimaryActions(
    props: {
        client: OAuth.PKCEClient, 
        messageIdsList: MessageIds[], 
        messageData: MessageData, 
        identifier: string, 
        isOffline: string, 
        showRaycastQuicklook?: boolean,
        storeCache?: boolean,
        isFetching?: boolean,
        newMessageId?: string, 
        messageBody?: string,

        prevPage?: ()=>void,
        currentPage?: number,
        nextPage?: ()=>void,
    }
    ): JSX.Element {
    const { push, pop } = useNavigation();
            
    let primaryQuicklookAction: JSX.Element = <Fragment></Fragment>;
    let subQuicklookAction: JSX.Element = <Fragment></Fragment>;

    const newRaycastQuicklookAction = (
        <Action.ToggleQuickLook title={"View Message in Quicklook"} icon={Icon.MagnifyingGlass} />
    )

    const newShellQuicklookAction = (
        <Action 
            title="View Message Using Shell" 
            icon={Icon.MagnifyingGlass} 
            shortcut={{ modifiers: ["opt"], key: "enter" }}
            onAction={async () => {
                //Fetch Message Body, Create A HTML Doc for it, Store it in the Temporary Files Directory, & Update The QuickLook File Path
                const expectedPath = getFilePathString(TEMP_FILE_PATH, {newFilePath: `/${props.client.providerId}/page-${props.currentPage}`, newFileUUID: props.messageData.MessageId})
                const directExists = await directoryExists(expectedPath);

                if (directExists) {
                    await showInQuicklookShell(expectedPath);
                    gmail.sleep(10)
                    open("raycast://")
                }
                else {
                    try {
                        const messageBody = await gmail.fetchMessageBody(props.client, props.messageData.MessageId, "text/html");
                        TEMP_FILE_PATH.FileUUID = `${props.client.providerId}`
                        TEMP_FILE_PATH.FileUUID = props.messageData.MessageId
        
                        const posixTempFilePath = await writeNewFile(TEMP_FILE_PATH, messageBody.toString());
        
                        if (!posixTempFilePath) return
                        await showInQuicklookShell(posixTempFilePath);
        
                        if (!props.storeCache) EXTENSION_CACHE.clear();
                        open("raycast://");

                    } catch(error) {
                        console.log(error);
                        showToast({title:"Failure", message:`Failed to load preview. Error: ` + JSON.stringify(error), style: Toast.Style.Failure})
                    }
                }

            }}
        />
    )

    if (props.storeCache && !props.isFetching) primaryQuicklookAction = newRaycastQuicklookAction;
    if (props.isOffline && props.storeCache) primaryQuicklookAction = newRaycastQuicklookAction
    
    if (!props.storeCache || !props.showRaycastQuicklook || props.isFetching ) primaryQuicklookAction = newShellQuicklookAction;
    if (props.storeCache && props.showRaycastQuicklook) subQuicklookAction = newShellQuicklookAction;

    const MessageSection = (
        <ActionPanel.Section title="Message Panel">
            <Action.OpenInBrowser title="Open Message In Browser" url={`https://mail.google.com/mail?authuser=${props.identifier}#all/${props.newMessageId}`} />
            <Action.CopyToClipboard title="Copy Message To Clipboard" content={`${props.messageBody}`} shortcut={{ modifiers: ["cmd"], key: "c" }} />
            {/* <Action title="Reply to Message" icon={Icon.Reply} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={ async() => { push(<ComposeForm client={props.client} messageData={messageData} />)}} /> */}
        </ActionPanel.Section>
    )

    const ModifySection = (
        <ActionPanel.Section title="Modify">
            <Action title="Compose Message" icon={Icon.Text} shortcut={{ modifiers: ["opt"], key: "w" }} onAction={ async() => { push(<ComposeForm client={props.client} />) }} />
            <Action 
                title="Trash Message" 
                icon={Icon.Trash}
                shortcut={{ modifiers: ["opt"], key: "t" }}
                onAction={ async () => {
                    const alertOptions: Alert.Options = {
                        title: "Trash Message?",
                        icon: Icon.Trash,
                        message: "Trashed messages will be deleted after 30 days. To recover a trashed message you need to go to your trash mailbox",
                        primaryAction: {
                            title: "Confirm",
                            style: Alert.ActionStyle.Destructive,
                        },
                        dismissAction: {
                            title: "Cancel",
                            style: Alert.ActionStyle.Cancel
                        }
                    }

                    if (await confirmAlert(alertOptions)) {
                        const response: Confirmation = await gmail.trashMessage(props.client, props.messageData.MessageId)

                        if (response.id) {
                            pop();
                            open("raycast://extensions/Reece/gmail-inbox/open-gmail-inbox");

                            showToast({title:"Success", message:`Trashed Message With Subject: ${props.messageData.Subject} \nMsgID: ${props.messageData.MessageId}`});
                        } else {
                            showToast({title:"Failure", message:`Failed to Trash Message With Subject: ${props.messageData.Subject} \nMsgID: ${props.messageData.MessageId}`, style: Toast.Style.Failure})
                        }
                    } else {
                        showToast({title:"Action Cancelled!"})
                    }

                }}
            />
        </ActionPanel.Section>
    )

    const MsgNavigationSection = (
        <ActionPanel.Section title="Navigation">
            <Action 
                title="View Previous Message" 
                icon={Icon.ChevronLeft} 
                shortcut={{ modifiers: [], key: "arrowLeft" }}
                onAction={ async () => {
                    pop() // "Pop" out of the current message body
                    await gmail.sleep(1) // "sleep" for 1ms and then "push" into the new message body
                    push(<MessageContent client={props.client} messageIdsList={props.messageIdsList} messageId={`${props.newMessageId}`} identifier={`${props.identifier}`} relativity="PrevMsg"/>) }
                }
            />
            <Action 
                title="View Next Message" 
                icon={Icon.ChevronRight} 
                shortcut={{ modifiers: [], key: "arrowRight" }}
                onAction={ async () => {
                    pop() // "Pop" out of the current message body
                    await gmail.sleep(1) // "sleep" for 1ms and then "push" into the new message body
                    push(<MessageContent client={props.client} messageIdsList={props.messageIdsList} messageId={`${props.newMessageId}`} identifier={`${props.identifier}`} relativity="NxtMsg"/>) }
                }
            />
        </ActionPanel.Section>
    )

    const PageNavigationSubmenu = (
        <ActionPanel.Submenu 
            title="Inbox Page Navigation" 
            shortcut={{modifiers: ["cmd", "shift"], key: "enter"}}
            icon={Icon.Code}>
            <Action 
                title="View Previous Page"
                icon={Icon.ChevronLeft} 
                onAction={props.prevPage} 
            />
            <Action 
                title="View Next Page" 
                icon={Icon.ChevronRight} 
                onAction={props.nextPage} 
            />
        </ActionPanel.Submenu>
    )

    const PreferencesSection = (
        <ActionPanel.Section title="Preferences">
            <ActionRemoveAccount userName={`${props.client.providerId}`} />
            <ActionSwitchAccount />
            <ActionManagePreferences isOffline={props.isOffline} />
        </ActionPanel.Section>
    )

    const AlternativeActions = (
        <ActionPanel.Submenu 
            title="Alternative Actions" 
            shortcut={{ modifiers: ["opt"], key: "a" }}
            icon={Icon.ChevronRight}
        >
            {subQuicklookAction}
            <Action 
                title="Scrape Message Body" 
                icon={Icon.QuoteBlock} 
                shortcut={{ modifiers: ["cmd", "opt"], key: "enter" }} 
                onAction={ () => { 
                    push(<MessageContent client={props.client} messageIdsList={props.messageIdsList} messageId={props.messageData.MessageId} identifier={props.identifier}/>) 
                }} 
            />
        </ActionPanel.Submenu>
    )

    const PrimarySection = (
        <ActionPanel.Section title="Primary Panel">
            {primaryQuicklookAction}
            <Action.OpenInBrowser title="Open Message In Browser" url={`https://mail.google.com/mail?authuser=${props.identifier}#all/${props.messageData.MessageId}`} />
            {/* <Action title="Reply to Message" icon={Icon.Reply} shortcut={{ modifiers: ["cmd"], key: "r" }} onAction={ async() => { push(<ComposeForm client={props.client} messageData={messageData} />)}} /> */}
            {PageNavigationSubmenu}
        </ActionPanel.Section>
    )

    const OfflineSection = (
        <Fragment>
            <ActionPanel.Section title="Offline Panel">
                {primaryQuicklookAction}
                {subQuicklookAction}
                <ActionManagePreferences isOffline={props.isOffline} />
            </ActionPanel.Section>
            <ActionPanel.Section title="Preferences">
                <ActionSwitchAccount />
                <ActionRemoveAccount userName={`${props.client.providerId}`}/>
            </ActionPanel.Section>

            <DebugSubmenu />
        </Fragment>
    )

    if (props.isOffline.includes("Offline")) return OfflineSection; // Offline Panel

    if (props.newMessageId) {
        return ( // MessageContent Panel
            <Fragment>
                {MessageSection}
                {MsgNavigationSection}
                {ModifySection}
            </Fragment>
        )
    } else {
        return ( // Primary MessageList Panel
            <Fragment>
                {PrimarySection}
                {ModifySection}
                {PreferencesSection}
                {AlternativeActions}
                <DebugSubmenu />
            </Fragment>
        )
    }
}

export function ActionSwitchAccount(): JSX.Element {
    const { pop } = useNavigation()

    return (
        <Action title="Switch Account" icon={Icon.PersonCircle} shortcut={{modifiers: ["opt"], key: "s"}} onAction={ async() => {
            const switchedUser = await oauth.switchToNextUser()
    
            if (switchedUser) {
                pop();
                open("raycast://extensions/Reece/gmail-inbox/open-gmail-inbox");
                showToast({title: "Success", message: `Switched to User "${switchedUser}"`});
            }
        }} />
    )
}

export function ActionRemoveAccount(props: {userName: string}): JSX.Element {
    return (
        <Action 
            title="Remove Account Alias"
            icon={Icon.RemovePerson}
            shortcut={{modifiers: ["opt"], key: "-"}}
            onAction={ async() => {
                    const alertOptions: Alert.Options = {
                        title: "Remove Account Alias?",
                        icon: Icon.RemovePerson,
                        message: `User "${props.userName}" will be removed & logged out`,
                        primaryAction: {
                            title: "Confirm",
                            style: Alert.ActionStyle.Destructive,
                        },
                        dismissAction: {
                            title: "Cancel",
                            style: Alert.ActionStyle.Cancel
                        }
                    }

                    if (await confirmAlert(alertOptions)) {
                        const oldUsersList = await oauth.getUsersList()

                            const userClient = new OAuth.PKCEClient ({
                                redirectMethod: OAuth.RedirectMethod.AppURI,
                                providerName: `Gmail`,
                                providerIcon: `gmail-icon.png`,
                                providerId: `${props.userName}`,
                                description: `Connect your Gmail account using Raycast!`,
                            });

                            oauth.clientLogout(userClient);
                            LocalStorage.removeItem(props.userName);
                            deleteFolder(TEMP_FILE_PATH.Directory + TEMP_FILE_PATH.DirecFolder + `/${props.userName}` )

                            const newUsersList = await oauth.getUsersList()

                        if (newUsersList.length < oldUsersList.length) {                                
                            if (newUsersList.length >= 1) {
                                const firstUser = JSON.parse(newUsersList[0])
                                const userAlias = firstUser.alias

                                LocalStorage.setItem( `${userAlias}`, `{"user":true, "fetchMail":true}` );
                            }

                            popToRoot();
                
                            await showToast({
                                title: "Success",
                                message: `User "${props.userName}" has been removed and you have been logged out`,
                                style: Toast.Style.Success,
                            })
                        } else {
                            showToast({title:"Failure", message:`Failed to remove account aliases and logout`, style: Toast.Style.Failure})
                        }
                    } else {
                        showToast({title:"Action Cancelled!"})
                    }
            }}
        />
    )
}

export function ActionRemoveAccountAliases(): JSX.Element {
    return (
        <Action 
            title="Remove Account Aliases"
            icon={Icon.RemovePerson}
            shortcut={{modifiers: ["cmd", "opt"], key: "-"}}
            onAction={ async() => {
                const storageData = await LocalStorage.allItems();

                    const alertOptions: Alert.Options = {
                        title: "Remove Account Aliases?",
                        icon: Icon.RemovePerson,
                        message: "All account aliases will be removed & all accounts will be logged out",
                        primaryAction: {
                            title: "Confirm",
                            style: Alert.ActionStyle.Destructive,
                        },
                        dismissAction: {
                            title: "Cancel",
                            style: Alert.ActionStyle.Cancel
                        }
                    }

                    if (await confirmAlert(alertOptions)) {
                        for (const [userName, storageValue] of Object.entries(storageData)) {
                            const storageValObj = JSON.parse(storageValue);
        
                            if (storageValObj.user == true) {
                                const userClient = new OAuth.PKCEClient ({
                                    redirectMethod: OAuth.RedirectMethod.AppURI,
                                    providerName: `Gmail`,
                                    providerIcon: `gmail-icon.png`,
                                    providerId: `${userName}`,
                                    description: `Connect your Gmail account using Raycast!`,
                                });
        
                                oauth.clientLogout(userClient);
                                LocalStorage.removeItem(userName);
                                deleteFolder(TEMP_FILE_PATH.Directory + TEMP_FILE_PATH.DirecFolder + `/${userName}` )
                            }
        
                        }

                        const usersList = await oauth.getUsersList()

                        if (usersList.length == 0) {
                            popToRoot();
                
                            await showToast({
                                title: "Success",
                                message: "Account aliases have been removed and you have been logged out",
                                style: Toast.Style.Success,
                            })
                        } else {
                            showToast({title:"Failure", message:`Failed to remove account aliases and logout`, style: Toast.Style.Failure})
                        }
                    } else {
                        showToast({title:"Action Cancelled!"})
                    }
            }}
        />
    )
}

export function ActionManagePreferences(props: {isOffline: string}): JSX.Element {
    const { push } = useNavigation();
    return <Action title="Manage Preferences" icon={Icon.HardDrive} shortcut={{modifiers: ["opt"], key: "p"}} onAction={ async() => { push(<PreferencesForm isOffline={props.isOffline} />) }}/>
}

export function DebugSubmenu(): JSX.Element {
    return (
    <ActionPanel.Submenu 
        title="Debug Gmail Inbox Data" 
        shortcut={{ modifiers: ["opt"], key: "d" } }
        icon={Icon.ChevronRight} 
    >
        <SubmenuDebugTempFiles />
        <SubmenuDebugCache />
        <SubmenuAliasesAndStorage />
    </ActionPanel.Submenu>
    )
}

export function SubmenuAliasesAndStorage(): JSX.Element {
    return (
        <ActionPanel.Submenu title="Debug > Local Storage & Tokens">
            <Action 
                title="Clear Local Storage & Logout"
                icon={Icon.Trash} 
                onAction={ async () => {
                    const storageData = await LocalStorage.allItems();

                    const alertOptions: Alert.Options = {
                        title: "Clear Local Storage & Logout? Cache will also be cleared.",
                        icon: Icon.Trash,
                        message: `Local storage is used to store user aliases. Login tokens are stored elsewhere by raycast, but aliases are codependant for identifying which login token to fetch when running this extension`,
                        primaryAction: {
                            title: "Confirm",
                            style: Alert.ActionStyle.Destructive,
                        },
                        dismissAction: {
                            title: "Cancel",
                            style: Alert.ActionStyle.Cancel
                        }
                    }

                    if (await confirmAlert(alertOptions)) {
                        for (const [userName, storageValue] of Object.entries(storageData)) {
                            const storageValObj = JSON.parse(storageValue);
        
                            if (storageValObj.user == true) {
                                const userClient = new OAuth.PKCEClient ({
                                    redirectMethod: OAuth.RedirectMethod.AppURI,
                                    providerName: `Gmail`,
                                    providerIcon: `gmail-icon.png`,
                                    providerId: `${userName}`,
                                    description: `Connect your Gmail account using Raycast!`,
                                });
        
                                oauth.clientLogout(userClient);
                                LocalStorage.removeItem(userName);
                            }
        
                        }

                        const usersList = await oauth.getUsersList()
                        if (usersList.length == 0) {
                            LocalStorage.clear()
                            EXTENSION_CACHE.clear()

                            popToRoot();
                            
                            await showToast({
                                title: "Success",
                                message: "Local Storage, alongside cache data, was cleared & you were logged out",
                                style: Toast.Style.Success,
                            })
                        } else {
                            showToast({title:"Failure", message:`Failed to remove account aliases and logout`, style: Toast.Style.Failure})
                        }
                    } else {
                        showToast({title:"Action Cancelled!"})
                    }
                }}
            />
        </ActionPanel.Submenu>
    )
}

export function SubmenuDebugTempFiles(): JSX.Element {
    return (
        <ActionPanel.Submenu title="Debug > Temp Files">
            <Action 
                title="Delete Temporary Files"
                icon={Icon.Trash} 
                onAction={ async () => {

                    const alertOptions: Alert.Options = {
                        title: "Permanently delete cached temp files?",
                        icon: Icon.Trash,
                        message: `Files stored in cache/htmlTempFiles are used to quicklook mail. New temp files are created everytime the extension is run if cache is turned on`,
                        primaryAction: {
                            title: "Confirm",
                            style: Alert.ActionStyle.Destructive,
                        },
                        dismissAction: {
                            title: "Cancel",
                            style: Alert.ActionStyle.Cancel
                        }
                    }

                    if (await confirmAlert(alertOptions)) {
                        const response = await deleteFolder(TEMP_FILE_PATH.Directory + TEMP_FILE_PATH.DirecFolder);
                        if (response == true) {
                            showToast({title:"Success: ", message:`Temp files have been deleted. \nPath: ${TEMP_FILE_DIRECTORY}`})
                            popToRoot()
                        }
                    } else {
                        showToast({title:"Action Cancelled!"})
                    }
                }}
            />
            <Action 
                title="Open Temp Files Folder" 
                icon={Icon.Folder} 
                onAction={ async () => { 
                    try {
                        const directoryExistsBoolean = await directoryExists(TEMP_FILE_DIRECTORY + TEMP_FILE_PATH.DirecFolder)

                        if (directoryExistsBoolean) {
                            await open(`${TEMP_FILE_DIRECTORY + TEMP_FILE_PATH.DirecFolder}`)
                        } else {
                            showToast({title:"Note: ", message:`There are currently no temp files cached. \nPath: ${TEMP_FILE_DIRECTORY}`})
                        }
                    } catch(error) {
                        console.log("error")
                        await gmail.sleep(250)
                        open(`raycast://`)
                        showToast({title:"Failure", message:`Failed to open Folder Path: ${TEMP_FILE_DIRECTORY + TEMP_FILE_PATH.DirecFolder}`, style: Toast.Style.Failure})
                    }
                } 
            }
            />
        </ActionPanel.Submenu>
    )
}

export function SubmenuDebugCache(): JSX.Element {
     return (
        <ActionPanel.Submenu title="Debug > Cache Data">
            <Action 
                title="Clear Cache Data"
                icon={Icon.Trash} 
                onAction={ async () => {

                    const alertOptions: Alert.Options = {
                        title: "Clear cache data?",
                        icon: Icon.Trash,
                        message: `Cache is used for offline access. It stores temp files alongside message headers & snippets`,
                        primaryAction: {
                            title: "Confirm",
                            style: Alert.ActionStyle.Destructive,
                        },
                        dismissAction: {
                            title: "Cancel",
                            style: Alert.ActionStyle.Cancel
                        }
                    }

                    if (await confirmAlert(alertOptions)) {
                        EXTENSION_CACHE.clear();

                        popToRoot()

                        showToast({title:"Success: ", message:`Cache data has been cleared. \nPath: ${TEMP_FILE_DIRECTORY}`})
                    } else {
                        showToast({title:"Action Cancelled!"})
                    }
                }}
            />
            <Action 
                title="Open Cache Files Folder"
                icon={Icon.Folder} 
                onAction={ async () => { 
                    try {
                        const directoryExistsBoolean = await directoryExists(TEMP_FILE_DIRECTORY)

                        if (directoryExistsBoolean) {
                            await open(`${TEMP_FILE_DIRECTORY}`)
                        } else {
                            showToast({title:"Note: ", message:`There is no cache directory found. \nPath: ${TEMP_FILE_DIRECTORY}`})
                        }
                    } catch(error) {
                        console.log("error")
                        await gmail.sleep(250)
                        open(`raycast://`)
                        showToast({title:"Failure", message:`Failed to open Folder Path: ${TEMP_FILE_DIRECTORY}`, style: Toast.Style.Failure})
                    }
                } 
            }
            />
        </ActionPanel.Submenu>
    )
}

export function getExtensionCache() { return EXTENSION_CACHE }
export function getFilePath() { return TEMP_FILE_PATH }

// Components' Functions
function stripHtml(html: string) {
    html = html.replace(/<br>/gi, "\n");
    html = html.replace(/<p.*>/gi, "\n");
    html = html.replace(/<a.*href="(.*?)".*>(.*?)<\/a>/gi, " $2 ([$1]($1)) ");
    html = html.replace(/<(?:.|\s)*?>/g, "");

    return html;
}

function stripWhitespace(string: string) {
    const lineArray = string.split("\r\n");
    let newString = "";

    for (let i = 0; i < lineArray.length; i++) {
        const newLine = lineArray[i].trim();
        newString += `\n${newLine}`;
    }

    newString = newString.replace(/(?:(?:\r\n|\r|\n)\s*){2,}/gim, "\n\n");
    
    return newString
}

function cleanString(string: string) {
    // https://stackoverflow.com/questions/822452/strip-html-from-text-javascript
    let returnText = "" + string;

    //-- remove BR tags and replace them with line break
    returnText=returnText.replace(/<br>/gi, "\n");
    returnText=returnText.replace(/<br\s\/>/gi, "\n");
    returnText=returnText.replace(/<br\/>/gi, "\n");

    //-- remove P and A tags but preserve what's inside of them
    returnText=returnText.replace(/<p.*>/gi, "\n");
    returnText=returnText.replace(/<a.*href="(.*?)".*>(.*?)<\/a>/gi, " $2 ([$1]($1)) ");

    //-- remove all inside SCRIPT and STYLE tags
    returnText=returnText.replace(/<script.*>[\w\W]{1,}(.*?)[\w\W]{1,}<\/script>/gi, "");
    returnText=returnText.replace(/<style.*>[\w\W]{1,}(.*?)[\w\W]{1,}<\/style>/gi, "");
    //-- remove all else
    returnText=returnText.replace(/<(?:.|\s)*?>/g, "");

    //-- get rid of more than 2 multiple line breaks:
    returnText=returnText.replace(/(?:(?:\r\n|\r|\n)\s*){2,}/gim, "\n\n");

    //-- get rid of more than 2 spaces:
    returnText = returnText.replace(/ +(?= )/g,'');

    //-- get rid of html-encoded characters:
    returnText=returnText.replace(/&nbsp;/gi," ");
    returnText=returnText.replace(/&amp;/gi,"&");
    returnText=returnText.replace(/&quot;/gi,'"');
    returnText=returnText.replace(/&lt;/gi,'<');
    returnText=returnText.replace(/&gt;/gi,'>');

   return returnText
}