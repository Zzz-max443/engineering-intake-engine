import { IntakeSession } from './engine/index.ts';
import { mountApp } from './ui/app.ts';
import { Controller } from './ui/controller.ts';

const root = document.getElementById('app');
if (!root) throw new Error('Missing #app element in index.html');

mountApp(root, new Controller(new IntakeSession()));
