import { Redirect } from 'expo-router';
/** Sanitized route only; credential parsing occurs before navigation in +native-intent. */
export default function CallbackPlaceholder() { return <Redirect href="/profile" />; }
