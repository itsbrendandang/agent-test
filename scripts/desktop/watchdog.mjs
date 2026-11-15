// Preloaded into the engine (node --import) by the desktop app. If the app that started the engine goes away
// without stopping it (a crash, a force quit, kill -9), the engine stops itself within a second or two, so no
// engine is left running. The parent is the app: when it dies, this process is handed to launchd (pid 1).
const parent = Number(process.env.ASB_PARENT_PID)
if (parent > 1) {
  const timer = setInterval(() => {
    if (process.ppid === parent) return
    console.error("the app that started this engine is gone; stopping")
    process.kill(process.pid, "SIGTERM") // the engine's own handler releases its run locks
    setTimeout(() => process.kill(process.pid, "SIGKILL"), 5000)
  }, 1000)
  timer.unref()
}
