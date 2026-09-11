const steps = Array.from(document.querySelectorAll('.step-item'));
const panels = Array.from(document.querySelectorAll('.panel'));

const backBtn = document.getElementById('btn-back');
const nextBtn = document.getElementById('btn-next');
const cancelBtn = document.getElementById('btn-cancel');
const acceptLicense = document.getElementById('accept-license');

const progressFill = document.getElementById('progress-fill');
const progressValue = document.getElementById('progress-value');
const progressLabel = document.getElementById('progress-label');
const taskListItems = Array.from(document.querySelectorAll('#task-list li'));

const installMessages = [
  'Extracting package...',
  'Installing dependencies...',
  'Applying browser defaults...',
  'Finalizing setup...'
];

let currentStep = 0;
let installProgress = 0;
let installTimer = null;

function setActiveStep(stepIndex) {
  currentStep = stepIndex;

  steps.forEach((stepEl, idx) => {
    stepEl.classList.toggle('is-active', idx === stepIndex);
    stepEl.classList.toggle('is-done', idx < stepIndex);
  });

  panels.forEach((panelEl, idx) => {
    panelEl.classList.toggle('is-active', idx === stepIndex);
  });

  backBtn.disabled = stepIndex === 0;

  if (stepIndex === 4) {
    nextBtn.textContent = 'Finish';
  } else if (stepIndex === 3) {
    nextBtn.textContent = 'Installing...';
  } else if (stepIndex === 2) {
    nextBtn.textContent = 'Install';
  } else {
    nextBtn.textContent = 'Next';
  }

  nextBtn.disabled = stepIndex === 3 || (stepIndex === 1 && !acceptLicense.checked);
}

function updateProgress(progress) {
  installProgress = Math.max(0, Math.min(100, progress));
  progressFill.style.width = `${installProgress}%`;
  progressValue.textContent = `${installProgress}%`;

  const taskIdx = Math.min(Math.floor(installProgress / 25), installMessages.length - 1);
  progressLabel.textContent = installMessages[taskIdx];

  taskListItems.forEach((item, idx) => {
    item.classList.toggle('is-done', idx < taskIdx || installProgress === 100);
  });

  if (installProgress === 100) {
    clearInterval(installTimer);
    installTimer = null;
    setTimeout(() => setActiveStep(4), 420);
  }
}

function runInstallSimulation() {
  if (installTimer) {
    return;
  }

  setActiveStep(3);
  updateProgress(0);

  installTimer = setInterval(() => {
    const jump = Math.round(Math.random() * 10) + 6;
    updateProgress(installProgress + jump);
  }, 280);
}

function goNext() {
  if (currentStep === 1 && !acceptLicense.checked) {
    return;
  }

  if (currentStep === 2) {
    runInstallSimulation();
    return;
  }

  if (currentStep === 4) {
    window.alert('Setup complete. You can now launch Vayu.');
    return;
  }

  const nextStep = Math.min(currentStep + 1, steps.length - 1);
  setActiveStep(nextStep);
}

function goBack() {
  if (currentStep <= 0 || currentStep === 3) {
    return;
  }

  setActiveStep(currentStep - 1);
}

nextBtn.addEventListener('click', goNext);
backBtn.addEventListener('click', goBack);

cancelBtn.addEventListener('click', () => {
  const shouldClose = window.confirm('Cancel setup? Your current configuration will not be installed.');
  if (shouldClose) {
    window.location.reload();
  }
});

acceptLicense.addEventListener('change', () => {
  if (currentStep === 1) {
    nextBtn.disabled = !acceptLicense.checked;
  }
});

steps.forEach((stepEl) => {
  stepEl.addEventListener('click', () => {
    const targetStep = Number(stepEl.dataset.step);

    if (currentStep === 3) {
      return;
    }

    if (targetStep > currentStep + 1) {
      return;
    }

    if (targetStep === 2 && currentStep === 1 && !acceptLicense.checked) {
      return;
    }

    setActiveStep(targetStep);
  });
});

setActiveStep(0);
