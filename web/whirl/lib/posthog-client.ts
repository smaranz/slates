/* Stands in for posthog-js: nothing is sent anywhere. */
const posthog = {
  capture: (..._args: unknown[]) => {},
  get_session_id: () => null as string | null,
};
export default posthog;
