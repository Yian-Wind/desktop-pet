import React from 'react'
import { createRoot } from 'react-dom/client'
import { PetWindow } from './components/PetWindow'
import { Panel } from './components/Panel'
import './styles.css'

const params = new URLSearchParams(window.location.search)
const isPanel = params.get('window') === 'panel'
document.body.classList.toggle('pet-mode', !isPanel)

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isPanel ? <Panel /> : <PetWindow />}
  </React.StrictMode>
)
