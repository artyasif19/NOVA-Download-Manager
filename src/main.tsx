import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { DialogWindow } from './components/DialogWindow';
import './index.css';

// Small pop-up windows (download confirmation / progress) open index.html?w=<kind>&d=<json>
const params = new URLSearchParams(window.location.search);
const popup = params.get('w');

createRoot(document.getElementById('root')!).render(
  popup ? <DialogWindow kind={popup} rawData={params.get('d') || '{}'} /> : <App />
);
