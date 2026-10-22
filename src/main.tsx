import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import App from './ui/App';
import { JobsView } from './ui/JobsView';
import './ui/index.css';

function Root() {
  const [hash, setHash] = useState(window.location.hash);

  useEffect(() => {
    const onHashChange = () => setHash(window.location.hash);
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  return hash === '#jobs' ? <JobsView /> : <App />;
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Could not find root element to mount to');
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
