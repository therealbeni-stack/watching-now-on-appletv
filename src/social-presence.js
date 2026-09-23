const { spawn } = require("child_process");
const path = require("path");

class SocialPresence {
  constructor(clientId) {
    this.clientId = clientId;
    this.proc = null;
    this.ready = false;
  }
  start() {
    const exe = path.join(__dirname, "..", "native", "bin", "social_bridge.exe");
    this.proc = spawn(exe, [this.clientId], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.proc.stdout.on("data", d => console.log("Discord Social SDK:", d.toString().trim()));
    this.proc.stderr.on("data", d => console.log("Discord Social SDK:", d.toString().trim()));
    this.proc.on("exit", c => console.log("Discord Social SDK bridge stopped:", c));
    this.ready = true;
  }
  send(obj) {
    if (!this.proc?.stdin?.writable) throw new Error("Social SDK bridge is not running");
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
  }
  setActivity(a) {
    this.send({
      type: "activity", details: a.details, state: a.state,
      largeImage: a.largeImageKey || "", largeText: a.largeImageText || "",
      start: a.startTimestamp ? +new Date(a.startTimestamp) : 0,
      end: a.endTimestamp ? +new Date(a.endTimestamp) : 0
    });
    return Promise.resolve();
  }
  clearActivity() { this.send({ type: "clear" }); return Promise.resolve(); }
}
module.exports = SocialPresence;
