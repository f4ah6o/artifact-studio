import BpmnModeler from 'bpmn-js/lib/Modeler';
import translations from 'bpmn-js-i18n/translations/ja.js';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

function translate(template, replacements = {}) {
  const translated = translations[template] || template;
  return translated.replace(/{([^}]+)}/g, (_, key) => replacements[key] || `{${key}}`);
}

const japaneseTranslateModule = {
  translate: ['value', translate],
};

export function createBpmnModeler(container) {
  return new BpmnModeler({
    container,
    additionalModules: [japaneseTranslateModule],
  });
}
