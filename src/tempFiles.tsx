import { runAppleScript } from "run-applescript";
import { Toast, showToast } from "@raycast/api";
import { writeFile, rm } from "fs/promises";
import { FilePath } from "./types";
import { existsSync, mkdirSync, readdirSync } from "fs";
import { deleteAsync } from "del";
import { join } from "path";
import { homedir } from "os";
import { getUsersList } from "./oauth";
import { getFilePath } from "./components";

export function getFilePathString(filePath: FilePath, options?: {newFilePath?: string, newFileUUID?: string, newFileName?: string, newFileExtension?: string}) { 
    if (options?.newFilePath) filePath.FilePath = options.newFilePath;
    if (options?.newFileUUID) filePath.FileUUID = options.newFileUUID;
    if (options?.newFileName) filePath.FileName = options.newFileName;
    if (options?.newFileExtension) filePath.FileExtension = options.newFileExtension;

    return filePath.Directory + filePath.DirecFolder + filePath.FilePath + filePath.FileName + filePath.FileUUID + filePath.FileExtension 
}

export async function getDirectoriesInDirectory(pathToDirectory: string) {
    const directoriesInDirectory = readdirSync(pathToDirectory, { withFileTypes: true })
        .filter((item) => item.isDirectory())
        .map((item) => item.name);

    return directoriesInDirectory;
}


export async function directoryExists(filePath: string): Promise<boolean | void> {
    try {
        if (existsSync (filePath) ) return true
        else return false
    } catch (error) {
        console.log("Directory Checker Failed: " + error);
        showToast({title:"Directory Checker Failed: ", message: `${error}`, style: Toast.Style.Failure});
    }
}

export async function writeNewFile(filePath: FilePath, source: string): Promise<string> {
    try {

        if (!existsSync (filePath.Directory + filePath.DirecFolder + filePath.FilePath) ) {
            // Directory does not exist so make it 
            try {
                mkdirSync(filePath.Directory + filePath.DirecFolder + filePath.FilePath, { recursive: true });
            } catch (error) {
                console.log("Make Directory Failed: " + error);
                showToast({title:"Make Directory Failed:", message: `${error}`, style: Toast.Style.Failure});
            }
        }
      } catch(error) {
        console.log("Directory Checker Failed: " + error);
        showToast({title:"Directory Checker Failed: ", message: `${error}`, style: Toast.Style.Failure});
      }

    const tempFilePath = getFilePathString(filePath);
    try {
        await writeFile(tempFilePath, source);
    } catch (error) {
        console.log("writeNewFile Failed: " + error);
        showToast({title:"writeNewFile Failed: ", message: `${error}`, style: Toast.Style.Failure});
    }

    return tempFilePath;
}

export async function writeFileToDesktop(source: string): Promise<void> {
    const filePath = join(homedir(), "Desktop", "tempFile.txt");
    await writeFile(filePath, source);
}

export async function deleteTempFiles(filePaths: string[]): Promise<string[]> { return await deleteAsync(filePaths) }

export async function deleteFolder(dirPath: string): Promise<boolean> {
    const direcExists = await directoryExists(dirPath)

    if (direcExists == true) {
        try {
            await rm(dirPath, { recursive: true })
            return true;
        } catch (error) {
            showToast({title:"Delete Temp File Directory Failed:", message: `${error}`, style: Toast.Style.Failure});
            console.log(error)
            return false
        }
    }

    return true
}

//Clean up any unnecessary excess files
export async function cleanUpFiles(): Promise<void> {
    const usersList = await getUsersList()

    for (const userObject of usersList) {
        const user = JSON.parse(userObject);

        const filePath = getFilePath()
        const currentDirectory = filePath.Directory + filePath.DirecFolder + `/${user.alias}`;

        const directExists = await directoryExists(currentDirectory)

        if (directExists) {
        const subDirectories = await getDirectoriesInDirectory(currentDirectory);

        subDirectories.map((subDirectory) => {
            // Delete every subdirectory found EXCEPT for the first page subdirectory
            // This is so temp files don't excessively build up
            // They are also cleaned when a user is removed, this is only for page cleaning
            //console.log(`Folders Cleaned: ~cache${filePath.DirecFolder}/${user.alias}` + subDirectory)
            if (subDirectory.includes("page-0")) return
            deleteFolder(currentDirectory + "/" + subDirectory);
        })
        }
    }
}

export async function showInQuicklookShell(posixFilePath: string) {
    try {
        await runAppleScript(` do shell script "qlmanage -p '${posixFilePath}' " `);
    } catch (error) {
        console.log(error)
        showToast({title:"Quicklook Exception", message:`Failed to Generate Preview`, style: Toast.Style.Failure})
    }
}

export async function showInQuicklookNative(posixFilePath: string) {
    try {
        //await runAppleScript(`do shell script "qlmanage -c public.html -p ${posixFilePath}"`);
        await runAppleScript(`
            set posixFilePath to "${posixFilePath}" -- /Users/reece/Desktop/RaycastAPI.html
            set fileReference to (POSIX file posixFilePath) as alias -- alias Macintosh HD:Users:reece:Desktop:RaycastAPI.html
            
            # Show saved file in quicklook
            tell application "Finder"
                activate
                reveal fileReference
                delay .1
                tell application "System Events" to key code 49 -- Key Code to Open in QuickLook
            end tell
        `);

    } catch (error) {
        console.log(error)
        showToast({title:"Quicklook Exception", message:`Failed to Generate Preview`, style: Toast.Style.Failure})
    }
}

export async function cleanQLManage() { await runAppleScript(`do shell script "qlmanage -r cache && qlmanage -r"`) }
export async function resetQuicklookCache() { await runAppleScript(`do shell script "qlmanage -r"`) }