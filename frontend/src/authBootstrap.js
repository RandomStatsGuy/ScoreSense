/** Config and identity are independent; keep the gate closed until both settle. */
export async function bootstrapAuth({ fetchConfig, refreshUser, applyConfig }) {
  const results = await Promise.allSettled([
    fetchConfig().then(applyConfig),
    refreshUser(),
  ]);
  const failure = results.find((result) => result.status === "rejected");
  if (failure) throw failure.reason;
}
