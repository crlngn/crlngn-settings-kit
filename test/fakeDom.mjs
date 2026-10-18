/**
 * A tiny stand-in for the DOM parts LockIcons touches: settings forms made of `.form-group`s, each
 * with a label and one named field, plus `document.createElement`, `getElementById` and `head`.
 * `root.scans` counts the field lookups, so tests can check a render is one pass.
 */

class FakeElement {
  constructor(tag) {
    this.tag = tag;
    this.className = '';
    this.id = '';
    this.dataset = {};
    this.children = [];
    this.disabled = false;
    this.classList = {
      add: (...names) => { this.className = [...this.#classes(), ...names].join(' '); },
      remove: (...names) => { this.className = this.#classes().filter(c => !names.includes(c)).join(' '); },
      contains: name => this.#classes().includes(name)
    };
  }

  #classes() {
    return this.className.split(' ').filter(Boolean);
  }

  prepend(child) {
    this.children.unshift(child);
  }

  querySelector(selector) {
    const cls = selector.replace(/^\./, '');
    return this.children.find(c => c.classList.contains(cls)) ?? null;
  }
}

export function installDocument() {
  const head = { styles: [], appendChild(el) { this.styles.push(el); } };
  globalThis.document = {
    head,
    createElement: tag => new FakeElement(tag),
    getElementById: id => head.styles.find(s => s.id === id) ?? null
  };
  return head;
}

/**
 * @param {string[]} names  Field names, one form group each
 */
export function makeForm(names) {
  const listeners = [];
  const groups = names.map(name => {
    const label = new FakeElement('label');
    const input = new FakeElement('input');
    const group = new FakeElement('div');
    input.name = name;
    input.getAttribute = () => name;
    input.closest = sel => (sel === '.form-group' ? group : null);
    group.querySelector = sel => (sel === 'label' ? label : null);
    group.querySelectorAll = () => [input];
    return { name, label, input, group };
  });
  const root = {
    scans: 0,
    dataset: {},
    listeners,
    groups,
    querySelectorAll() { this.scans += 1; return groups.map(g => g.input); },
    addEventListener(type, fn) { listeners.push({ type, fn }); }
  };
  return root;
}

/** The lock icon drawn into a field's label, if any */
export function iconOf(root, name) {
  return root.groups.find(g => g.name === name).label.querySelector('.sk-lock');
}

/** Click a GM lock icon through the form's listeners */
export async function click(root, icon, type = 'click') {
  const event = {
    type,
    altKey: false,
    target: { closest: () => icon },
    preventDefault() {},
    stopPropagation() {}
  };
  for (const l of root.listeners.filter(l => l.type === type)) await l.fn(event);
}
