import HomeScreen from './index';

/** Reuse the existing input screen; no second editor or save implementation. */
export default function CaptureManualInput() { return <HomeScreen initialScreen="input" />; }
