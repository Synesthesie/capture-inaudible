const {app, dialog} = require('electron').remote;
const win = require('electron').remote.getCurrentWindow();
const {desktopCapturer} = require('electron');
const {execFile} = require('child_process');
const {shell} = require('electron');
const createMicInstance = require('mic');
const $ = require('jquery');
const temp = require('temp');
const fs = require('fs');
const path = require('path');
const cpFile = require('cp-file');
const ftpClient = require('ftp');
const Oscillator = require('./oscillator.js');
const server = require('./server-config.js');

// Debug
const isPrintingDebugLogs = true;

// Encoding options
const options = {
    channels: 'stereo',
    algorithm: 'abr',
    vbrQuality: '2',
    abrBitrate: '256',
    cbrBitrate: '256',
    upload: false
};
// Objet storing the path to the source file, and its status (mic recording or existing file)
const src = {
    isValidDataLoaded: false,
    isFromMicrophone: false,
    isMono: false,
    path: ''
};
// Microphone recording instance
let micInstance;
// Microphone recording start time
let micRecStartTime;
// Boolean indicating if a file is currently being processed
let isProcessingFile = false;
// Boolean indicating if the user has made an action to close the window
let isClosingWindow = false;

// Determine paths to external executables according to the current platform
const binPaths = (() => {
    let platform;
    if (process.platform === 'darwin' && process.arch === 'x64') {
        platform = 'darwin-x64/';
    } else if (process.platform === 'win32' && process.arch === 'x64') {
        platform = 'win32-x64/';
    } else if (process.platform === 'linux' && process.arch === 'x64') {
        platform = 'linux-x64/';
    }
    const base = app.getAppPath() + '/vendor/bin/';
    let p = [
        'lame/lame',
        'sox/sox',
        'inaudible-dsp/inaudible-dsp'
    ];
    p = p.map((a) => path.join(base + platform + a));
    // Replace app.asar by app, a folder in which the binaries will be placed by electron-builder extraResources option. We can't use asarUnpack because that would only work for exexFile processes, and we need a spawn for mic recording (+ problems on how to include the *.pyc files that are ignored by default by electron-builder into the asar-unpacked folder)
    return {
            lame: p[0].replace('app.asar', 'app'),
            sox: p[1].replace('app.asar', 'app'),
            inaudibleDsp: p[2].replace('app.asar', 'app')
        };
})();

// Prepare audio playback at window closing
var context = new AudioContext();
var osc = new Oscillator(context);
osc.init();
osc.oscillator.type = 'sine';
var wave = 'sine';

function upload(input, destPath) {
    const uploadDirPath = 'test-inaudible/';
    const isUsingCompression = false;
    const date = new Date();
    const prep = (d) => {
        // Prepend 0 if necessary (source: https://stackoverflow.com/questions/3605214/javascript-add-leading-zeroes-to-date)
        return ('0' + d).slice(-2);
    };
    let output = date.getFullYear() + '-' + prep((date.getMonth() + 1)) + '-' + prep(date.getDate()) + '_' + prep(date.getHours()) + '-' + prep(date.getMinutes()) + '-' + prep(date.getSeconds()) + '_' + path.basename(destPath);
    output = output.substring(0, 256); // Truncate to 256 chars
    return new Promise((resolve, reject) => {
        const c = new ftpClient();
        c.on('ready', () => {
            c.put(input, uploadDirPath + output, isUsingCompression, (err) => {
                if (err) {
                    console.log(err);
                    reject(new Error('upload error'));
                } else {
                    c.end();
                    log('Uploaded :\n' + input + '\nto:\n' + uploadDirPath + output);
                    resolve(true);
                }
            });
        });
        c.on('error', (err) => {
            console.log(err);
            reject(new Error('upload error'));
        });
        c.connect({
            host: server.host,
            port: server.port,
            secure: server.secure,
            user: server.user,
            password: server.password
        });
    });
}

function srcCheck(input) {
    return new Promise((resolve, reject) => {
        const opt = ['--i', input];
        execFile(binPaths.sox, opt, (err, stdout) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                let isMono = false;
                if (stdout.split('\n')[2].indexOf('1') !== -1) {
                    isMono = true;
                }
                resolve(isMono);
            }
        });
    });
}

$('.landing').each(function() {
    setTimeout(() => {
        $(this).hide();
    }, 3000);
});

$('.landing').click(function() {
    $(this).hide();
});

$('.main-see-archive').click(function() {
    shell.openExternal('http://artkillart.org');
});

$('.main-microphone-button').click(function() {
    const e = $(this);
    if (!e.hasClass('disabled')) {
        if (!isProcessingFile) {
            if (!e.hasClass('active')) {
                e.addClass('disabled'); // On recording activation, disable the button to make it impossible to stop the recording before the audiostream is ready, so we are sure to always get a non empty audio recording
                e.addClass('active');
                const output = temp.path({suffix: '.wav'});
                addToTempFileList(output);
                micInstance = createMicInstance({sox: binPaths.sox});
                const micInputStream = micInstance.getAudioStream();
                micInputStream.pipe(fs.WriteStream(output));
                micInputStream.on('start', () => {
                    micRecStartTime = new Date();
                    e.removeClass('disabled'); // Audiostream is ready: allow stopping the recording from now on
                    $('.main-microphone .on-off').text('on');
                });
                micInputStream.on('stop', () => {
                    src.path = output;
                    src.isFromMicrophone = true;
                    src.isValidDataLoaded = true;
                    e.removeClass('active');
                    $('.main-microphone .on-off').text('off');
                    log('Recorded ' + computeElapsedTime(micRecStartTime));
                    log('Created temp file:\n' + output + '\nfor microphone recording.');
                });
                micInputStream.on('error', (err) => {
                    console.log(err);
                });
                micInstance.start();
            } else {
                micInstance.stop();
            }
        } else {
            showStatusPleaseWait();
        }
    }
});

function normalize(input) {
    // Normalize the file to prepare for silence trimming
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.wav'});
        addToTempFileList(output);
        const opt = [input, output, 'norm']
        execFile(binPaths.sox, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor trimming amount computation (1/2).');
                resolve(output);
            }
        });
    });
};

function trimInitSilence(input) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.wav'});
        addToTempFileList(output);
        const opt = [input, output, 'silence', '1', '0.01', '1%']; // 1% should allow trimming silent analog signals. 0.1% can be used to trim only pure digital silence (0% doesn't).
        execFile(binPaths.sox, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor trimming amount computation (2/2).');
                resolve(output);
            }
        });
    });
}

function preStandardizeEncoding(input) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.wav'});
        addToTempFileList(output);
        const opt = [input, '-r', '44100', '-b', '16', output];
        execFile(binPaths.sox, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\n for encoding pre-standardization.');
                resolve(output);
            }
        });
    });
}

function computeTrimmingAmount(input) {
    // Compute the amount of trimming to apply at the beginning of the user loaded or recorded file based on a temp normalized version of this file. The use of a normalized version makes the trimming threshold independant of the input file's signal level, which prevents trimming everything if this level is too low.
    // By working on a temporary normalized file and not normalizing the user provided file directly, we can also choose freely to normalize or not the result of inaudible-dsp (whereas normalization would be compulsory if we normalized the user input file).
    return new Promise((resolve, reject) => {
        computeDuration(input)
            .then((d) => {
                srcDuration = d; // Duration before trimming
                return normalize(input);
            })
            .then((normalizedTempPath) => {
                return trimInitSilence(normalizedTempPath);
            })
            .then((initSilenceTrimmedTempPath) => {
                return computeDuration(initSilenceTrimmedTempPath);
            })
            .then((d) => {
                preDuration = d; // Duration after trimming the normalized file
                resolve(srcDuration-preDuration);
            })
            .catch((err) => {
                console.log(err);
                reject(err);
            });
    });
}

function preStandardizeStartPointAndChannels(input, trimmingAmount, options) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.wav'});
        addToTempFileList(output);
        const opt = [input, output];
        if (trimmingAmount > 0) {
            // Remove silence at the beginning of the file based on the duration that has previously been computed
            opt.push(...['trim', trimmingAmount.toString() + 's']);
        }
        if (src.isMono) {
            // Possible cases: mono to mono, mono to stereo
            opt.push(...['remix', '1', '1']); // Duplicate the mono channel on each channel of the output file
        } else if (options.channels === 'mono') {
            // Possible case: stereo to mono
            // (nothing to do for stereo to stereo case)
            opt.push(...['remix', '1-2', '1-2']); // Create a mono mix-down and duplicate it on each chanel of the output file
        }
        execFile(binPaths.sox, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor start point and channels pre-standardization.');
                resolve(output);
            }
        });
    });
};

function computeDuration(input) {
    return new Promise((resolve, reject) => {
        const opt = ['--i', input];
        execFile(binPaths.sox, opt, (err, stdout) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                let d = stdout.split('\n')[5];
                d = parseInt(d.replace(/.+ (\d+) sample.*/, '$1'));
                resolve(d);
            }
        });
    });
};

function postStandardize(input, paddingAmount, suffix) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: suffix});
        addToTempFileList(output);
        const opt = [input, output];
        if (options.channels === 'mono') {
            // If the mono option is selected, the channels of the input file will have previously been set equal, regardless of its type (mono or stereo). So we can select the left channel in all cases.
            opt.push(...['remix', '1']);
        }
        if (paddingAmount > 0) {
            // Reintroduce silence at the beginning to account for the silence that was trimmed during pre standardisation
            // The fade prevents clicks at the end of the end of the added silence zone (ie, beginning of the 'non-silence' audio)
            opt.push(...['fade', '0.050', 'pad', paddingAmount.toString() + 's']); // s for samples
        }
        execFile(binPaths.sox, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor post-standardization.');
                resolve(output);
            }
        });
    });
};

function mp3Encode(input, options) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.mp3'});
        addToTempFileList(output);
        const opt = ['--silent', '--resample', '44.1']; // Force sample rate at 44.1 kHz (provide args with space as separate items in the array!)
        if (options.algorithm === 'vbr') {
            opt.push(...['-V', options.vbrQuality]);
        } else if (options.algorithm === 'abr') {
            opt.push(...['--abr', options.abrBitrate]);
        } else if (options.algorithm === 'cbr') {
            opt.push(...['--cbr', '-b', options.cbrBitrate]);
        }
        opt.push(...['-m', 's']); // Simple stereo
        // console.log(opt.reduce((s, e) => s + ' ' + e, 'lame')); // Debug: print encoding options
        // ---------------------------
        opt.push(...[input, output]);
        execFile(binPaths.lame, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor mp3 encoding.');
                resolve(output);
            }
        });
    });
};

function mp3Decode(input) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.wav'});
        addToTempFileList(output);
        const opt = ['--silent', '--decode', input, output];
        execFile(binPaths.lame, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor mp3 decoding.');
                resolve(output);
            }
        });
    });
};

function inaudibleProcess(reference, input) {
    return new Promise((resolve, reject) => {
        const output = temp.path({suffix: '.wav'});
        addToTempFileList(output);
        const opt = [reference, input, output];
        execFile(binPaths.inaudibleDsp, opt, (err) => {
            if (err) {
                console.log(err);
                reject(err);
            } else {
                log('Created temp file:\n' + output + '\nfor inaudible processing.');
                resolve(output);
            }
        });
    });
};

function addToTempFileList(path) {
    // We have to create a new arrat and assign to the cleanupCallbackList property. It wouldn't work if we assigned cleanupCallbackList to an array in this file, as the array would be copied by value.
    const t = require('electron').remote.getGlobal('sharedObject').pendingTempCleanups;
    require('electron').remote.getGlobal('sharedObject').pendingTempCleanups = t.concat([path]);
}

function getIsMicrophoneRecording() {
    return $('.main-microphone-button').hasClass('active') ? true : false;
}

$('.main-select-wav-aiff-button').click(function() {
    if (!$(this).hasClass('disabled')) {
        if (!isProcessingFile && !getIsMicrophoneRecording()) {
            $(this).addClass('disabled'); // Disable to prevent opening two dialogs with double-click
            dialog.showOpenDialog({
                // title: 'Sélectionnez un fichier audio (wav)', // doesn't seem to work
                filters: [
                    {name: 'WAV or AIFF audio file', extensions: ['wav', 'aif', 'aiff']}
                ]
            }, (filePaths) => {
                $(this).removeClass('disabled'); // Always re-enable when closing dialog
                if (filePaths !== undefined) {
                    srcCheck(filePaths[0])
                        .then((isMono) => {
                            src.path = filePaths[0];
                            src.isFromMicrophone = false;
                            src.isValidDataLoaded = true;
                            src.isMono = isMono;
                            console.log('Loaded: ' + path.basename(src.path));
                        })
                        .catch((err) => {
                            src.isValidDataLoaded = false;
                            dialog.showErrorBox('Error', 'The selected file is not a valid WAV or AIFF file.');
                        });
                }
            });
        } else if (isProcessingFile) {
            showStatusPleaseWait();
        } else {
            showMicrophonePleaseWait();
        }
    }
});

$('.option').click(updateOptions);

function log(m) {
    if (isPrintingDebugLogs) {
        console.log(m);
    }
}
function updateOptions() {
    const e = $(this);
    let name = e.attr('class').split(' ')[0].substring(5);
    if (name.startsWith('add-file-archive')) {
        if (e.hasClass('active')) {
            options.upload = false;
        } else {
            options.upload = true;
        }
        e.toggleClass('active');
    } else if (name.startsWith('stereo')) {
        options.channels = 'stereo';
        e.addClass('active');
        $('.main-mono-button').removeClass('active');
    } else if (name.startsWith('mono')) {
        options.channels = 'mono';
        e.addClass('active');
        $('.main-stereo-button').removeClass('active');
    } else if (name.startsWith('vbr')) {
        options.algorithm = 'vbr';
        options.vbrQuality = e.data('value').toString();
        $('[class^=main-vbr], [class^=main-abr], [class^=main-cbr] ').removeClass('active');
        e.addClass('active');
    } else if (name.startsWith('abr')) {
        options.algorithm = 'abr';
        options.abrBitrate = e.data('value').toString();
        $('[class^=main-vbr], [class^=main-abr], [class^=main-cbr] ').removeClass('active');
        $('[class^=main-vbr], [class^=main-abr], [class^=main-cbr] ').removeClass('active');
        options.algorithm = 'abr';
        e.addClass('active');
    } else if (name.startsWith('cbr')) {
        options.algorithm = 'cbr';
        options.cbrBitrate = e.data('value').toString();
        $('[class^=main-vbr], [class^=main-abr], [class^=main-cbr] ').removeClass('active');
        $('[class^=main-vbr], [class^=main-abr], [class^=main-cbr] ').removeClass('active');
        options.algorithm = 'cbr';
        e.addClass('active');
    }
    // console.log(options); // Debug
}

$('.main-save-button').click(function() {
    if (!$(this).hasClass('disabled') && src.isValidDataLoaded) {
        if (!isProcessingFile && !getIsMicrophoneRecording()) {
            $(this).addClass('disabled');
            const currOptions = {}; // Backup options in case the user changes them during processing
            for (var attr in options) {
                if (options.hasOwnProperty(attr)) {
                    currOptions[attr] = options[attr];
                }
            }
            let destPath;
            if (!src.isFromMicrophone) {
                destPath = src.path.substring(0, src.path.lastIndexOf(".")) + '_inaudible' + path.extname(src.path);
            } else {
                destPath = app.getPath('desktop') + '/recording_inaudible.wav';
            }
            dialog.showSaveDialog({
                defaultPath: destPath,
                properties: ['openDirectory'],
                showsTagField: false
            }, (filePath) => {
                $(this).removeClass('disabled');
                if (filePath !== undefined) {
                    let destSuffix = path.extname(filePath);
                    if (destSuffix !== '.wav' && destSuffix !== '.WAV' && destSuffix !== '.aif' && destSuffix !== '.AIF' && destSuffix !== '.aiff' && destSuffix !== '.AIFF') {
                        // If wrong or no extension is provided, set to wav
                        filePath = path.basename(filePath, destSuffix) + '.wav';
                        destSuffix = '.wav';
                    }
                    isProcessingFile = true;
                    destPath = filePath; // Update with the name chose by the user
                    displayStatusText('processing file');
                    displayOutputPath(path.basename(destPath));
                    let pre; // Path to the most recent temp files created as part of the pre standardization process
                    let post; // Path to the temp file obtained after the post standardization step
                    let srcDuration; // Duration of the file provided by the user
                    let preDuration; // Duration after silence trimming
                    let trimmingAmount;

                    // -------- Main Processing Routine --------
                    // 1. preStandardizeEncoding: SoX is used to convert the src file to a 44100 Hz, 16 bit standardized wav.
                    // 2. computeTrimmingAmount: SoX is used to determine the amount of silence to remove at the beginning of the src file, so we are sure we don't try to run inaudible-dsp —which takes into account only the beginning of its input— to a silent portion of the src file.
                    // 3. preStandardizeStartPointAndChannels: SoX is used to trim the amount computed during step 2 from the src file, as well as transforming it—in any case— to a stereo file. The function prepares a stereo file which vary depending on the conversion scenario: mono to mono,  mono to stereo, stereo to stereo and stereo to mono.
                    // 4. mp3Encode: Lame is used to encode the result of 3 to an mp3 file with the chosen options
                    // 5. mp3Decode: Lame is used to decode the result of 4 to a wav or aiff file.
                    // 6. inaudibleProcess: inaudible-dsp is used to compute the difference between the result of 3 and the result of 5.
                    // 7. postStandardize: Sox is used to add back to trimmed silence at the beginning of the result of 6, and —if the mono option has been selected— to convert its stereo channels to a mono file.
                    // 8. cpFile: the result of 7 is renamed to the final file name.
                    // 9 (optional). upload: The result of 7 is uploaded to the server. Uploading this temp file (and not the result of 8) prevents the user from deleting the file while it is being uploaded.
                    // -----------------------------------------
                    preStandardizeEncoding(src.path)
                        .then((encodingPreStandardizedTempPath) => {
                            pre = encodingPreStandardizedTempPath;
                            return computeTrimmingAmount(pre);
                        })
                        .then((d) => {
                            trimmingAmount = d;
                            return preStandardizeStartPointAndChannels(pre, trimmingAmount, currOptions);
                        })
                        .then((startPointAndChannelsPreStandardizedTempPath) => {
                            pre = startPointAndChannelsPreStandardizedTempPath;
                            return mp3Encode(pre, currOptions);
                        })
                        .then((mp3TempPath) => mp3Decode(mp3TempPath))
                        .then((wavFromMp3TempPath) => inaudibleProcess(pre, wavFromMp3TempPath))
                        .then((inaudibleProcessedTempPath) => postStandardize(inaudibleProcessedTempPath, trimmingAmount, destSuffix))
                        .then((postStandardizedTempPath) => {
                            post = postStandardizedTempPath;
                            return cpFile(postStandardizedTempPath, destPath); // Write the final file
                        })
                        .then(() => {
                            log('Copied:\n' + post + '\nto:\n' + destPath);
                            if (currOptions.upload) {
                                displayStatusText('uploading to archive');
                                return upload(post, destPath);
                            } else {
                                displayStatusText('saved file'); // This will be the last message
                                return Promise.resolve();
                            }
                        })
                        .then(() => {
                            if (currOptions.upload) {
                                displayStatusText('saved file'); // This only makes sense if the upload option has been set
                            }
                            isProcessingFile = false;
                        })
                        .catch((err) => {
                            if (err.message === 'upload error') {
                                displayStatusText('upload failed');
                                isProcessingFile = false;
                            } else {
                                dialog.showErrorBox('Error', 'An error occurred during the processing of the file.');
                            }
                        });
                }
            });
        } else if (isProcessingFile) {
            showStatusPleaseWait();
        } else {
            showMicrophonePleaseWait();
        }
    }
});

function showMicrophonePleaseWait() {
    $('.main-microphone .please-wait').show();
    setTimeout(() => {
        $('.main-microphone .please-wait').hide();
    }, 3000);
}

function showStatusPleaseWait() {
    $('.main-status .please-wait').show();
    setTimeout(() => {
        $('.main-status .please-wait').hide();
    }, 3000);
}

function displayOutputPath(s) {
    $('.main-output-path').text(s);
}

function displayStatusText(s) {
    $('.main-status .text').text(s);
}

function computeElapsedTime(startTime) {
    const now = new Date();
    const diff = now - startTime;
    const hours   = Math.floor(diff / 3.6e6);
    const minutes = Math.floor((diff % 3.6e6) / 6e4);
    const seconds = Math.floor((diff % 6e4) / 1000);
    let s = '';
    if (hours !== 0)  {
        s += hours + ' hour' + (hours > 1 ? 's' : '') + ', ';
    }
    if (minutes !== 0)  {
        s += minutes + ' minute' + (minutes > 1 ? 's' : '') + ' and ';
    }
    s += seconds + ' seconds';
    return s;
}


win.on('close', () => {
    // Check if we're not already processing a 'close' event. This prevents user double-clicking on the close button (which would play the exit sound twice)
    if (!isClosingWindow) {
        isClosingWindow = true;
        if (isProcessingFile) {
            displayIsProcessingDialog((response) => {
                if (response === 0) {
                    showExitPage();
                    // Ideally, we should also check if an upload is in progress and cancel. Or we may get truncated files on the server. But is it possible technically to cancel this? Also, this may not be compatible with the need to display the exit page very quickly when closing the program.
                } else {
                    isClosingWindow = false; // Cancel close procedure
                }
            });
        } else {
            showExitPage();
        }
    }
});

function showExitPage() {
    let f;
    $('.landing').hide(); // Case when exiting from the landing page
    $('.exit').show();
    const r = Math.random();
    if (r < 0.5) {
        $('.exit-1').show();
        f = 8;
    } else {
        $('.exit-2').show();
        f = 17000;
    }
    osc.play(f);
    setTimeout(closeWindow, 333); // 1/3s - fade out time (10ms)
}

function closeWindow() {
    osc.stop();
    setTimeout(win.destroy, 10); // Wait 10ms, in accordance to the fade out time in the Oscillator class, to let the sound fade out
}

function displayIsProcessingDialog(callback) {
    dialog.showMessageBox({
        type: 'question',
        buttons: ['Quit', 'Cancel'],
        defaultId: 0,
        title: 'Test',
        message: 'An operation is in progress. Quit anyway?',
        cancelId: 1
    }, (response) => callback(response));
}
