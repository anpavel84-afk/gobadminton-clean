import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Modal, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import type { FriendlyMatch as Match } from '../play-interest-coordinator.ts';
import { sameActor } from '../participation.ts';
import { colors } from '../theme.ts';
import { PlayerAvatar } from './player-card.tsx';
import { Label, PrimaryButton, ScreenFrame, TextButton, styles } from './ui.tsx';
import type { PublicPlayer } from '../players.ts';
function player(p:Match['peer']):PublicPlayer {return {...p,cityId:null,areaKey:null,level:null,bio:null,trainer:false,lookingForGame:false};}
/** The existing ordinary contact owner rechecks rights and validated conversation headers on explicit CTA. */
export async function openFriendlyContact(match:Match, contact:ReturnType<typeof useAuth>['contact'], valid:()=>boolean):Promise<string|null> {
  if(!valid())return null;
  await contact.openComposer(match.peer.publicPlayerId);
  if(!valid())return null;
  const s=contact.getSnapshot();
  if(!sameActor(match.actor,s.actor) || s.target!==match.peer.publicPlayerId || s.command)return null;
  if(s.status==='existing' && s.conversation)return `/messages/direct/${s.conversation.id}`;
  return s.status==='ready' ? `/messages/new/${match.peer.publicPlayerId}` : null;
}
export function FriendlyMatch({match,onDismiss,current}:{match:Match;onDismiss:()=>void;current:()=>boolean}) {
  const auth=useAuth(),router=useRouter(),title=useRef<View>(null),mounted=useRef(true);
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{
    mounted.current=true;
    AccessibilityInfo.announceForAccessibility('Партнёр найден. Дружеский матч.');
    const handle=findNodeHandle(title.current);if(handle)AccessibilityInfo.setAccessibilityFocus(handle);
    return ()=>{mounted.current=false;};
  },[]);
  const valid=()=>mounted.current && current();
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onDismiss}>
    <ScreenFrame><ScrollView contentContainerStyle={{padding:20,gap:24,paddingBottom:40}}>
      <TextButton title="Закрыть дружеский матч" onPress={onDismiss} />
      <Label style={{color:colors.purple,fontWeight:'700'}}>ДАВАЙ СЫГРАЕМ</Label>
      <Label style={{backgroundColor:colors.limeSoft,borderRadius:16,padding:12}}>Партнёр найден</Label>
      <View ref={title} accessible accessibilityRole="header"><Label style={[styles.title,{fontSize:40,lineHeight:46}]}>Дружеский матч</Label></View>
      <Label>Вы оба хотите сыграть в бадминтон.</Label>
      <View style={{flexDirection:'row',flexWrap:'wrap',gap:24,justifyContent:'space-around',padding:20,borderRadius:20,backgroundColor:colors.lavender}}>
        {([['Это вы',match.self],['Ваш партнёр',match.peer]] as const).map(([caption,p])=><View key={caption} style={{alignItems:'center',gap:12,flexShrink:1,maxWidth:'100%'}}>
          <PlayerAvatar player={player(p)} large /><Label>{caption}</Label><Label style={{fontWeight:'700',textAlign:'center'}}>{p.displayName}</Label>
        </View>)}
      </View>
      {notice && <Label accessibilityLiveRegion="polite">{notice}</Label>}
      <PrimaryButton title={busy ? 'Проверяем…' : 'Написать'} disabled={busy} onPress={()=>{
        if(busy || !valid())return;setBusy(true);setNotice(null);
        void openFriendlyContact(match,auth.contact,valid).then(path=>{
          if(!valid())return;
          if(path){onDismiss();router.push(path as '/messages');}
          else setNotice('Сейчас написать этому игроку нельзя. Повторите проверку позже.');
        }).catch(()=>{if(valid())setNotice('Не удалось проверить возможность общения. Повторите проверку.');})
          .finally(()=>{if(valid())setBusy(false);});
      }} />
      <TextButton title="Продолжить поиск" onPress={onDismiss} />
      <Label>Матч не добавляет вас в друзья. Первое сообщение — только по вашему решению.</Label>
    </ScrollView></ScreenFrame>
  </Modal>;
}
