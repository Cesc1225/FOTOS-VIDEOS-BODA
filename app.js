const fileInput = document.getElementById("fileInput");
const selectBtn = document.getElementById("selectBtn");
const uploadBtn = document.getElementById("uploadBtn");
const fileList = document.getElementById("fileList");
const dropZone = document.getElementById("dropZone");
const statusEl = document.getElementById("status");
const progressBar = document.getElementById("progressBar");

const MAX_FILES = 10;
// Se deja en 30 MB porque el archivo viaja como Base64 y aumenta de tamaño.
const MAX_FILE_BYTES = 30 * 1024 * 1024;

let selectedFiles = [];
let currentUpload = null;
let uploadFrame = null;

const bytes = n => {
  if (!n) return "0 B";
  const u = ["B", "KB", "MB", "GB"];
  const i = Math.min(Math.floor(Math.log(n) / Math.log(1024)), 3);
  return `${(n / 1024 ** i).toFixed(i ? 1 : 0)} ${u[i]}`;
};

const esc = s => s.replace(/[&<>"']/g, c => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;"
}[c]));

function render() {
  fileList.innerHTML = "";
  selectedFiles.forEach((f, i) => {
    const r = document.createElement("div");
    r.className = "file-item";
    r.innerHTML = `
      <div class="file-icon">${f.type.startsWith("video/") ? "▶" : "▧"}</div>
      <div class="file-info">
        <div class="file-name">${esc(f.name)}</div>
        <div class="file-size">${bytes(f.size)}</div>
      </div>
      <button class="remove" data-i="${i}" type="button">×</button>`;
    fileList.appendChild(r);
  });
  uploadBtn.disabled = !selectedFiles.length || !!currentUpload;
}

function add(files) {
  const rejected = [];
  for (const f of Array.from(files)) {
    if (!(f.type.startsWith("image/") || f.type.startsWith("video/"))) {
      rejected.push(`${f.name}: tipo no permitido`);
    } else if (f.size > MAX_FILE_BYTES) {
      rejected.push(`${f.name}: supera 30 MB`);
    } else if (selectedFiles.length < MAX_FILES) {
      selectedFiles.push(f);
    } else {
      rejected.push(`${f.name}: máximo 10 archivos`);
    }
  }
  render();
  statusEl.textContent = rejected.length
    ? `Omitidos: ${rejected.join(" · ")}`
    : `${selectedFiles.length} archivo(s) listo(s).`;
}

selectBtn.onclick = () => fileInput.click();
fileInput.onchange = () => {
  add(fileInput.files);
  fileInput.value = "";
};

fileList.onclick = e => {
  const b = e.target.closest(".remove");
  if (b && !currentUpload) {
    selectedFiles.splice(+b.dataset.i, 1);
    render();
  }
};

["dragenter", "dragover"].forEach(x => dropZone.addEventListener(x, e => {
  e.preventDefault();
  dropZone.classList.add("dragover");
}));
["dragleave", "drop"].forEach(x => dropZone.addEventListener(x, e => {
  e.preventDefault();
  dropZone.classList.remove("dragover");
}));
dropZone.ondrop = e => add(e.dataTransfer.files);

function b64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error(`No se pudo leer ${file.name}`));
    r.readAsDataURL(file);
  });
}

function ensureFrame() {
  if (uploadFrame) return uploadFrame;
  uploadFrame = document.createElement("iframe");
  uploadFrame.name = "galeriaUploadFrame";
  uploadFrame.title = "Procesamiento de subida";
  uploadFrame.style.cssText = "position:absolute;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";
  document.body.appendChild(uploadFrame);
  return uploadFrame;
}

function send(file, index, total) {
  return new Promise(async (resolve, reject) => {
    try {
      currentUpload = { resolve, reject, file };
      render();
      statusEl.textContent = `Preparando ${index + 1} de ${total}: ${file.name}`;
      progressBar.style.width = `${Math.round((index / total) * 100)}%`;

      const data = await b64(file);
      const frame = ensureFrame();
      const form = document.createElement("form");
      form.method = "POST";
      form.action = APPS_SCRIPT_URL;
      form.target = frame.name;
      form.style.display = "none";

      const fields = {
        action: "upload",
        fileName: file.name,
        mimeType: file.type,
        data
      };

      Object.entries(fields).forEach(([name, value]) => {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = name;
        input.value = value;
        form.appendChild(input);
      });

      document.body.appendChild(form);
      statusEl.textContent = `Subiendo ${index + 1} de ${total}: ${file.name}`;
      form.submit();
      form.remove();

      // Si Google no responde dentro de este tiempo, mostramos un error claro.
      currentUpload.timeout = setTimeout(() => {
        if (currentUpload && currentUpload.reject === reject) {
          currentUpload = null;
          reject(new Error("Google Apps Script no respondió. Revisa la implementación /exec."));
        }
      }, 120000);
    } catch (e) {
      currentUpload = null;
      reject(e);
    }
  });
}

window.addEventListener("message", event => {
  const data = event.data;
  if (!data || data.type !== "galeria-surrealista-result" || !currentUpload) return;

  const pending = currentUpload;
  currentUpload = null;
  clearTimeout(pending.timeout);

  if (data.result && data.result.ok) {
    pending.resolve(data.result);
  } else {
    pending.reject(new Error((data.result && data.result.message) || "Google Drive rechazó el archivo."));
  }
});

uploadBtn.onclick = async () => {
  if (!selectedFiles.length || currentUpload) return;

  if (APPS_SCRIPT_URL.includes("PEGA_AQUI")) {
    statusEl.textContent = "Coloca primero la URL /exec en config.js.";
    return;
  }

  const fs = [...selectedFiles];
  uploadBtn.disabled = true;
  selectBtn.disabled = true;
  progressBar.style.width = "0%";

  try {
    for (let i = 0; i < fs.length; i++) {
      await send(fs[i], i, fs.length);
      progressBar.style.width = `${Math.round(((i + 1) / fs.length) * 100)}%`;
    }
    statusEl.textContent = `✓ ${fs.length} archivo(s) subido(s) correctamente.`;
    selectedFiles = [];
    render();
  } catch (e) {
    statusEl.textContent = "No se pudo completar: " + e.message;
  } finally {
    currentUpload = null;
    uploadBtn.disabled = !selectedFiles.length;
    selectBtn.disabled = false;
  }
};
