import { usePlaybackSync } from './audio/usePlayback'
import { Controls } from './components/Controls'
import { Visualizer } from './scene/Visualizer'

export default function App() {
  usePlaybackSync()

  return (
    <div className="app">
      <Visualizer />
      <Controls />
    </div>
  )
}
