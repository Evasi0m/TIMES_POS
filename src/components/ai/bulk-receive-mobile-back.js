import { saveDraft } from '../../lib/ai-draft.js';

export function flushDraftNow(bills, currentIdx, usage) {
  const slim = bills.map(({ previewUrl, ...rest }) => rest); // eslint-disable-line no-unused-vars
  return saveDraft({ bills: slim, currentIdx, usage });
}

export function resolveMobileBackAction({ macroStep, wizardCanBack }) {
  if (macroStep === 'work') {
    return wizardCanBack ? 'wizardBack' : 'goToList';
  }
  return 'pause';
}
