import { OAuth, getPreferenceValues, LocalStorage, showToast } from "@raycast/api";
import { UserReference } from "./types"

import { URLSearchParams } from "url";
import fetch from "node-fetch";

// User Client Id
export const preferences = getPreferenceValues();
const clientId = preferences.clientId;

export function providedClientId(): boolean {
  if (getPreferenceValues().clientId == null) return false;
  else return true;
}

// Client Email
// export function generateClient(emailAlias: string): OAuth.PKCEClient {
//     return new OAuth.PKCEClient ({
//       redirectMethod: OAuth.RedirectMethod.AppURI,
//       providerName: `Gmail`,
//       providerIcon: `gmail-icon.png`,
//       providerId: `gmail-${emailAlias}`,
//       description: `Connect your Gmail account using Raycast!`,
//     });
// }

export async function getIdToken(client: OAuth.PKCEClient) {
  // Check for authentication credentials
  const tokenSet = await client.getTokens();
  return tokenSet?.idToken
}

export async function authenticate(client: OAuth.PKCEClient): Promise<void> {
  // Check for authentication credentials
  const tokenSet = await client.getTokens();

  if (tokenSet?.accessToken) {
    if (tokenSet.refreshToken && tokenSet.isExpired()) {
      await client.setTokens(await refreshTokens(tokenSet.refreshToken));
    }
    return
  }


  // If there are none then send an authorization request to authenticate the user
  const authRequest = await client.authorizationRequest({
    endpoint: "https://accounts.google.com/o/oauth2/v2/auth",
    clientId: clientId,
    scope: "https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.modify",
  });
  const { authorizationCode } = await client.authorize(authRequest);

  // Authenticate the user and eventually store the authentication credentials
  await client.setTokens(await fetchTokens(authRequest, authorizationCode));
}

async function fetchTokens(authRequest: OAuth.AuthorizationRequest, authCode: string): Promise<OAuth.TokenResponse> {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("code", authCode);
  params.append("verifier", authRequest.codeVerifier);
  params.append("grant_type", "authorization_code");
  params.append("redirect_uri", authRequest.redirectURI);

  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: params });
  if (!response.ok) {
    console.error("fetch tokens error:", await response.text());
    throw new Error(response.statusText);
  }

  return (await response.json()) as OAuth.TokenResponse;
}

async function refreshTokens(refreshToken: string): Promise<OAuth.TokenResponse> {
  const params = new URLSearchParams();
  params.append("client_id", clientId);
  params.append("refresh_token", refreshToken);
  params.append("grant_type", "refresh_token");

  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", body: params });
  if (!response.ok) {
    console.error("refresh tokens error:", await response.text());
    throw new Error(response.statusText);
  }
  const tokenResponse = (await response.json()) as OAuth.TokenResponse;
  tokenResponse.refresh_token = tokenResponse.refresh_token ?? refreshToken;
  return tokenResponse;
}

export async function getClientToken(client: OAuth.PKCEClient) {
  return (await client.getTokens())?.accessToken
}

export async function getUserAlias(): Promise<string | void> {
  const storageData = await LocalStorage.allItems();

  const responseList = Object.entries(storageData).map(([emailAlias, value]) => {
    const valueObj = JSON.parse(value);
    if (valueObj.user == true && valueObj.fetchMail == true) { return emailAlias }
  })

  const userAlias = responseList.filter((responseItem) => responseItem != undefined)

  return userAlias[0];
}

export async function getUsersList(): Promise<Array<string>> {
  const storageData = await LocalStorage.allItems();
  const userList = [];

  for (const [key, value] of Object.entries(storageData)) {
    const valueObj = JSON.parse(value);

    if (valueObj.user == true) {
      userList.push(`{"alias": "${key}", "fetchMail": ${valueObj.fetchMail}}`)
    }
  }

  return userList;
}

export async function switchToNextUser(): Promise<string | undefined> {
  const userReferences = await getUserReferences();

  if (userReferences) {
    const currentUserAlias = userReferences.currentUser.alias;
    const nextUserAlias = userReferences.nextUser.alias;
  
    setUserInactive(currentUserAlias);
    setUserActive(nextUserAlias);

    return nextUserAlias
  }
}

export async function getUserReferences(): Promise<UserReference | null> {
  const userList = await getUsersList();

  if (userList.length == 1) {
    showToast({ title: "Note: ", message: "There aren't any other accounts to switch to" });
    return null;
  }
  const sortedUserList = userList.sort();


  const userResponses = sortedUserList.map((user, index) => {
    const userObj = JSON.parse(user);

    if (userObj.fetchMail == true) {
      const currentUser = userObj;
      return { currentUser: currentUser, userIndex: index }
    }
  });

  const activeUser = userResponses.filter((user) => user != undefined)[0];

  if (activeUser != undefined) {
    let inactiveUser;
    // If there is a user at the index of "nextUserIndex" then set it to "nextUser," else start over and set the first account in the list to "nextUser"
    if ((sortedUserList.length - 2) < activeUser.userIndex) inactiveUser = sortedUserList[0];
    else inactiveUser = sortedUserList[activeUser.userIndex + 1];

    const nextUser = JSON.parse(inactiveUser);

    const userRef: UserReference = {
      currentUser: activeUser.currentUser,
      nextUser: nextUser
    }

    return userRef;
  }

  return null
}

export async function setUserInactive(userAlias: string): Promise<void> { LocalStorage.setItem(userAlias, `{"user":true, "fetchMail":false}`) }
export async function setUserActive(userAlias: string): Promise<void> { await LocalStorage.setItem(userAlias, `{"user":true, "fetchMail":true}`) }

export async function clientLogout(client: OAuth.PKCEClient): Promise<void> {
  await client.removeTokens();
}