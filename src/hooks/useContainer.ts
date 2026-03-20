// Isolated hook export — required for Vite Fast Refresh compatibility.
// ContainerContext.tsx exports ContainerProvider (a component), so hooks
// must live in a separate file to avoid the "incompatible exports" HMR warning.
export { useContainer } from '../context/ContainerContext';
