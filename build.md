# Capturing the inaudible

## Info

Artwork by Matthieu Saladin.
Programming by Ianis Lallemand.
See CREDITS.md for open source licenses.

## Build instructions

Tested on node `8.4.0` and npm `5.4.0`.
These commands are tested on macOS. Linux and Windows distributions can and should be generated from the macOS machine.

- Install dependencies: `npm install`

- Package the app, create installers, rename (and compress if necessary): run `npm run dist-darwin-x64`, `npm run dist-win32-x64` or `npm run dist-linux-x64` depending on your platform.

Note: on Linux, the .appImage file needs to be packaged inside a tarball to preserve permissions, otherwise it will be necessary to chmod +x the file before opening it.

- Package the app without creating installers (for testing): run `npm run test-darwin-x64`, `npm run test-win32-x64` or `npm run test-linux-x64`.

### Troubleshooting

If `npm run dist-darwin-x64` fails, it might be necessary to `chmod +x ./node_modules/7z-bin-mac/7za`.

## Install

### Windows

Run the .exe file.

### macOS

Open the .dmg file and copy the app to the Applications folder.

### Linux

Uncompress the .tgz file (using the command 'tar xzvf file.tgz') and run the .appImage. If the users refuses to integrate the app to the system, the app will simply launch.
