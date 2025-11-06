// src/main.tsx（例）
import { BrowserRouter } from 'react-router-dom'
import App from './App'
createRoot(document.getElementById('root')!).render(
  <BrowserRouter basename={__BASE_PATH__ as string}>
    <App />
  </BrowserRouter>
)
)
