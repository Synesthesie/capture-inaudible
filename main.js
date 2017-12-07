const {app, dialog, BrowserWindow} = require('electron');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Keep a global reference of the window object, if you don't, the window will be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

// Shared data
global.sharedObject = {
    pendingTempCleanups: [], // Maintain a list of cleanup callbacks for created temp files
    isProcessingFile: false
}

function createWindow() {
    // Create the browser window and load the index.html of the app
    let opt = {
            width: 722,
            height: 400,
            useContentSize: true,
            resizable: false,
            maximizable: false,
            fullscreen: false,
            fullscreenable: false
        };
    if (process.platform === 'linux') {
        // On linux, we need to explicitely set the launcher bar icon as it will not be set automatically by electron-builder
        opt.icon = path.join(app.getAppPath(), 'src/icons/512x512.png');
    }
    mainWindow = new BrowserWindow(opt);
    mainWindow.setResizable(false);
    mainWindow.loadURL(url.format({
        pathname: path.join(app.getAppPath(), 'index.html'),
        protocol: 'file:',
        slashes: true
    }));

    // Debug
    // mainWindow.webContents.openDevTools();

    mainWindow.on('close', (event) => {
        // Prevent default closing behavior here in all cases because this can't be done on a case by case basis in the renderer process, where we attach an handler to the window's close event. This is because the callback we pass there to the close event is processed asynchronously in the main process, so the window will close before the callback will have a chance to be run (thus, it is not possible to prevent a window from closing in a callback passed in the renderer process).
        // Note: this will prevent gulp's electron-connect to restart the app
        event.preventDefault();
    });

    mainWindow.on('closed', function() {
        mainWindow = null;
    });
}

// This method will be called when Electron has finished initialization and is ready to create browser windows.  Some APIs can only be used after this event occurs.
app.on('ready', createWindow);

// Quit when all windows are closed.
app.on('window-all-closed', function() {
    app.quit();
});

app.on('quit', function() {
    global.sharedObject.pendingTempCleanups.forEach((e) => {
        if (fs.existsSync(e)) {
            console.log('cleaning ' + e);
            fs.unlinkSync(e);
        }
    });
});

app.on('activate', function () {
    // On OS X it's common to re-create a window in the app when the dock icon is clicked and there are no other windows open.
    if (mainWindow === null) {
        createWindow();
    }
});
