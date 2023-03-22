import { Toast, showToast } from "@raycast/api"
import { useEffect, useState } from "react"

import { PrimaryScreen, PreferencesForm} from "./components"
import * as oauth from "./oauth"
import { cleanUpFiles } from "./tempFiles";

export default function SearchInbox() {

  const [userAlias, setUserAlias] = useState<string | void>("");

  useEffect(()=>{
    (async()=> {
      const resultAlias = await oauth.getUserAlias()

      // Clean up any excessive files & set user alias, in order to login
      if (resultAlias) cleanUpFiles()
      setUserAlias(resultAlias);
    })();
  }, [])

  try {
    if (userAlias == undefined) { return <PreferencesForm isOffline={"Online"} /> }

    if (userAlias != undefined) { return <PrimaryScreen userAlias={userAlias} /> }

  } catch (error) {
    console.log(error);
    showToast({style: Toast.Style.Failure, title: String(error)}) // Return a Toast if there are any errors
  }
}