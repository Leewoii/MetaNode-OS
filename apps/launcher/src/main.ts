import { invoke } from "@tauri-apps/api/core";
import "./styles.css";

type LauncherStatus = {
  online: boolean;
  approved: boolean;
  coreInstalled: boolean;
  ollamaAvailable: boolean;
  userId: string;
  message: string;
};

const startButton = document.querySelector<HTMLButtonElement>("#start-button")!;
const stopButton = document.querySelector<HTMLButtonElement>("#stop-button")!;
const statusDot = document.querySelector<HTMLSpanElement>("#status-dot")!;
const statusText = document.querySelector<HTMLElement>("#status-text")!;
const message = document.querySelector<HTMLElement>("#message")!;
const coreState = document.querySelector<HTMLElement>("#core-state")!;
const ollamaState = document.querySelector<HTMLElement>("#ollama-state")!;
const userIdInput = document.querySelector<HTMLInputElement>("#user-id-input")!;

startButton.addEventListener("click", async () => runAction("start_core"));
stopButton.addEventListener("click", async () => runAction("stop_core"));
userIdInput.addEventListener("change", async () => {
  setBusy(true);
  try {
    render(await invoke<LauncherStatus>("set_user_id", { userId: userIdInput.value }));
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  } finally {
    setBusy(false);
  }
});

void refreshStatus();

async function runAction(command: "start_core" | "stop_core") {
  setBusy(true);
  try {
    const result = await invoke<LauncherStatus>(command);
    render(result);
  } catch (error) {
    render({
      online: false,
      approved: false,
      coreInstalled: false,
      ollamaAvailable: false,
      userId: userIdInput.value,
      message: error instanceof Error ? error.message : String(error)
    });
  } finally {
    setBusy(false);
  }
}

async function refreshStatus() {
  try {
    render(await invoke<LauncherStatus>("launcher_status"));
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : String(error);
  }
}

function render(status: LauncherStatus) {
  statusDot.classList.toggle("online", status.online);
  statusText.textContent = status.online ? "Online" : "Offline";
  message.textContent = status.message;
  coreState.textContent = status.coreInstalled ? "Installed" : "Not installed";
  ollamaState.textContent = status.ollamaAvailable ? "Available" : "Unavailable";
  if (document.activeElement !== userIdInput) userIdInput.value = status.userId;
  startButton.disabled = status.online;
  stopButton.disabled = !status.online;
}

function setBusy(busy: boolean) {
  startButton.disabled = busy;
  stopButton.disabled = busy;
  startButton.textContent = busy ? "Working..." : "Start";
}
