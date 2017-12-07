var gulp = require('gulp');
var electron = require('electron-connect').server.create();
const {execFile} = require('child_process');

var browserSync = require('browser-sync');

gulp.task('default', ['killall-electron', 'start-electron-server', 'watch-restart', 'move-electron-window']);

// Utility tasks
// -------------
gulp.task('watch-restart', ['start-electron-server'], () => {
    return gulp.watch(['*.js', '*.html', '*.css'], ['killall-electron', 'restart-electron', 'move-electron-window']);
});

gulp.task('restart-electron', ['killall-electron'], electron.restart);

gulp.task('killall-electron', (end) => {
    // This task is a hack that allows to use electron-connect while preventing the default window close action in the electron app's main.js. Without manually killing the electron process as we do here, we would create a new electron instance at each restart. With this hack, we still get an error in gulp's output, but the restart works as expected.
    // Make sure killall-electron.sh is executable
    execFile('./dev/scripts/killall-electron.sh', (err, stdout) => {
        if (err) {
            console.log(err);
        }
        end();
    });
});

gulp.task('move-electron-window', (end) => {
    setTimeout(() => {
        // Make sure move-electron-window.sh is executable
        execFile('./dev/scripts/move-electron-window.sh', (err, stdout) => {
            if (err) {
                console.log(err);
            }
            end(); // Required if we want gulp to wait for the timeout delay before declaring the task as finished
        });
    }, 1000);
});

gulp.task('start-electron-server', () => {
    electron.start();
});

// Temp
// ----

gulp.task('browser-test', ['browser-sync', 'watch-reload']);

gulp.task('watch-reload', ['browser-sync'], function() {
    return gulp
        .watch([
            '*.js',
            '*.html',
            '*.css'
        ])
        .on('error', handleError) // Prevents crashing if a file gets moved trough Kirby's panel
        .on('change', browserSync.reload);
});

gulp.task('browser-sync', function() {
    browserSync.init({
        server: {
            baseDir: './'
        }
    });
});

function handleError(err) {
    console.log(err.toString());
    this.emit('end');
}
