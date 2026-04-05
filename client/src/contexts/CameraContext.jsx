import React, { createContext, useContext, useState } from 'react';

const CameraContext = createContext();

export const useCameraContext = () => {
  const context = useContext(CameraContext);
  if (!context) {
    throw new Error('useCameraContext must be used within a CameraProvider');
  }
  return context;
};

export const CameraProvider = ({ children }) => {
  // 'earth', 'moon', or 'spacecraft'
  const [focusTarget, setFocusTarget] = useState('earth');

  return (
    <CameraContext.Provider value={{ focusTarget, setFocusTarget }}>
      {children}
    </CameraContext.Provider>
  );
};
