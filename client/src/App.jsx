import React from 'react';
import { SpaceScene } from './components/scene/SpaceScene';
import { TelemetryDashboard } from './components/ui/TelemetryDashboard';
import { MissionTimeline } from './components/ui/MissionTimeline';
import { MissionInfo } from './components/ui/MissionInfo';
import { CameraControlsUI } from './components/ui/CameraControlsUI';
import { TelemetryProvider } from './contexts/TelemetryContext';
import { CameraProvider } from './contexts/CameraContext';

function App() {
  return (
    <TelemetryProvider>
      <CameraProvider>
        <div className="relative w-full h-screen overflow-hidden bg-space-black font-sans select-none">
          {/* Base Layer: 3D Scene */}
          <div className="absolute inset-0 z-0">
            <SpaceScene />
          </div>

          {/* HUD Layer: Pointer events none so user can click/drag the 3D scene through empty spaces */}
          <div className="absolute inset-0 z-10 pointer-events-none">
            <TelemetryDashboard />
            <MissionInfo />
            <MissionTimeline />
            <CameraControlsUI />

            {/* Corner watermark */}
            <div className="absolute bottom-4 right-6 text-gray-500 text-[10px] tracking-widest uppercase hidden lg:block">
              Artemis II Mission Tracker
            </div>
          </div>
        </div>
      </CameraProvider>
    </TelemetryProvider>
  );
}

export default App;
