import { useEffect, useState, useSyncExternalStore } from 'react';
import { StyleSheet, View } from 'react-native';
import { publicApi } from '../public-api.ts';
import { RoleReputationCoordinator } from '../role-reputation.ts';
import { RoleLaneView } from './game-role-reputation.tsx';

function createProfileCoordinator() {
  return new RoleReputationCoordinator({
    // Game ports stay strict; profile mode never calls them.
    gameRole: async () => {
      throw new Error('game role path is not used on player profile');
    },
    byHandle: async () => {
      throw new Error('game handle path is not used on player profile');
    },
    playerRole: (publicPlayerId, role, query, signal) =>
      publicApi.playerRoleReputation(publicPlayerId, role, query, signal),
  });
}

/**
 * Direct public organizer/trainer history on a loaded player profile — read-only.
 * Mount only after the existing native profile gate has that peer; no disclosure wrapper.
 */
export function PlayerRoleReputation({ publicPlayerId }: { publicPlayerId: string }) {
  const [coordinator] = useState(createProfileCoordinator);
  const state = useSyncExternalStore(coordinator.subscribe, coordinator.getSnapshot, coordinator.getSnapshot);

  useEffect(() => {
    coordinator.bindPlayer(publicPlayerId);
    return () => { coordinator.collapse(); };
  }, [coordinator, publicPlayerId]);

  if (state.publicPlayerId !== publicPlayerId) return null;

  return <View style={styles.wrap} accessibilityLabel="Репутация ролей">
    <RoleLaneView
      lane={state.organization}
      onRetry={() => coordinator.retry('organization')}
      onMore={() => coordinator.loadMore('organization')}
    />
    <RoleLaneView
      lane={state.training}
      onRetry={() => coordinator.retry('training')}
      onMore={() => coordinator.loadMore('training')}
    />
  </View>;
}

const styles = StyleSheet.create({
  wrap: { width: '100%', gap: 14, paddingTop: 8 },
});
