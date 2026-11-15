import type { ComponentRef } from 'react';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, Image, Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useAuth } from '../auth.tsx';
import type { FriendlyMatch as Match } from '../play-interest-coordinator.ts';
import { sameActor } from '../participation.ts';
import { colors } from '../theme.ts';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { playerInitials } from '../presentation.ts';
import { playerMediaUrl } from '../media.ts';
import { DiscoveryIcon } from './discovery-icon.tsx';
import { Label, PrimaryButton, ScreenFrame, TextButton } from './ui.tsx';
/** Same approved uploaded/provider media projection, with real-name fallback in match colors. */
function MatchAvatar({identity,self,size}:{identity:Match['peer'];self:boolean;size:number}) {
  const [failed,setFailed]=useState<string[]>([]);
  const uri=[identity.avatar?.uploadedUrl,identity.avatar?.providerUrl].map(url=>playerMediaUrl(url,'avatar')).find(url=>url && !failed.includes(url));
  return <View accessible={false} style={{width:size,height:size,borderRadius:size/2,borderWidth:5,borderColor:colors.card,overflow:'hidden',backgroundColor:self?colors.lime:colors.purple,alignItems:'center',justifyContent:'center'}}>
    {uri ? <Image source={{uri}} style={{width:'100%',height:'100%'}} onError={()=>setFailed(old=>[...old,uri])} />
      : <Label style={{fontSize:31,lineHeight:40,fontWeight:'600',color:self?colors.ink:colors.card}}>{playerInitials(identity.displayName)}</Label>}
  </View>;
}
/** The existing ordinary contact owner rechecks rights and validated conversation headers on explicit CTA. */
export async function openFriendlyContact(match:Match, contact:ReturnType<typeof useAuth>['contact'], valid:()=>boolean):Promise<string|null> {
  if(!valid())return null;
  await contact.open(match.peer.publicPlayerId);
  if(!valid())return null;
  const s=contact.getSnapshot();
  if(!sameActor(match.actor,s.actor) || s.target!==match.peer.publicPlayerId || s.command)return null;
  if(s.status==='existing' && s.conversation)return `/messages/direct/${s.conversation.id}`;
  return s.status==='ready' ? `/messages/new/${match.peer.publicPlayerId}` : null;
}
export function FriendlyMatch({match,onDismiss,current}:{match:Match;onDismiss:()=>void;current:()=>boolean}) {
  const auth=useAuth(),router=useRouter(),title=useRef<ComponentRef<typeof View>>(null),mounted=useRef(true);
  const insets=useSafeAreaInsets(),viewport=useWindowDimensions();
  const compact=viewport.height-insets.top-insets.bottom<760;
  const avatarSize=Math.max(48,Math.min(compact?88:104,(viewport.width-insets.left-insets.right-96)/2));
  const [busy,setBusy]=useState(false),[notice,setNotice]=useState<string|null>(null);
  useEffect(()=>{
    mounted.current=true;
    AccessibilityInfo.announceForAccessibility('Партнёр найден. Дружеский матч.');
    const handle=findNodeHandle(title.current);if(handle)AccessibilityInfo.setAccessibilityFocus(handle);
    return ()=>{mounted.current=false;};
  },[]);
  const valid=()=>mounted.current && current();
  return <Modal visible animationType="none" presentationStyle="fullScreen" onRequestClose={onDismiss}
    onShow={()=>{const handle=findNodeHandle(title.current);if(handle)AccessibilityInfo.setAccessibilityFocus(handle);}}>
    <ScreenFrame><ScrollView contentContainerStyle={{flexGrow:1,paddingHorizontal:24,paddingTop:14,paddingBottom:insets.bottom+20}}>
      <View style={{flexDirection:'row',alignItems:'center',justifyContent:'space-between',gap:12,marginBottom:compact?8:20}}>
        <Label style={{flex:1,color:colors.secondary,fontWeight:'600',fontSize:11,lineHeight:16,letterSpacing:1.3}}>ДАВАЙ СЫГРАЕМ</Label>
        <Pressable accessibilityRole="button" accessibilityLabel="Закрыть дружеский матч" onPress={onDismiss}
          style={{minWidth:48,minHeight:48,borderRadius:24,borderWidth:1,borderColor:colors.line,alignItems:'center',justifyContent:'center'}}><DiscoveryIcon name="close" /></Pressable>
      </View>
      <View style={{alignItems:'center',gap:compact?14:20}}>
        <View style={{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:colors.limeSoft,borderRadius:24,paddingVertical:7,paddingHorizontal:11}}>
          <Svg accessible={false} width={14} height={14} viewBox="0 0 16 16" fill="none"><Path d="m3 8 3 3 7-7" stroke={colors.ink} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" /></Svg>
          <Label style={{fontSize:11,lineHeight:16,fontWeight:'600',flexShrink:1}}>Партнёр найден</Label>
        </View>
        <View ref={title} accessible accessibilityRole="header" accessibilityLabel="Дружеский матч">
          <Label accessible={false} style={{fontSize:compact?44:52,lineHeight:compact?46:54,fontWeight:'700',letterSpacing:-2,textAlign:'center'}}>Дружеский</Label>
          <Label accessible={false} style={{fontSize:compact?44:52,lineHeight:compact?46:54,fontWeight:'700',letterSpacing:-2,textAlign:'center',color:colors.purple}}>матч</Label>
        </View>
        <Label style={{fontSize:14,lineHeight:21,color:colors.secondary,textAlign:'center',maxWidth:280}}>Вы оба хотите сыграть в бадминтон.</Label>
      </View>
      <View style={{marginTop:compact?14:24,marginHorizontal:-8,paddingTop:28,paddingBottom:12,minHeight:compact?156:180}}>
        <Svg accessible={false} viewBox="0 0 500 230" preserveAspectRatio="none" width="100%" height={compact?156:180} style={{position:'absolute',top:0}} fill="none">
          <Rect x={0} y={0} width={500} height={230} rx={18} fill={colors.lavender} />
          <Rect x={24} y={30} width={452} height={170} rx={10} stroke="#d8c8f2" strokeWidth={1.3} />
          <Path d="M24 65h452M24 165h452M56 30v170M444 30v170M250 30v170M24 115h452" stroke="#d8c8f2" strokeWidth={1.3} />
          <Path d="M113 158C160 17 319 9 391 114" stroke={colors.purple} strokeWidth={1.5} strokeDasharray="4 7" opacity={0.6} />
        </Svg>
        <View style={{flexDirection:'row',alignItems:'flex-start'}}>
          <View style={{flex:1,minWidth:0,alignItems:'center',gap:6}}>
            <MatchAvatar identity={match.self} self size={avatarSize} />
            <Label style={{fontSize:11,lineHeight:16,color:colors.secondary}}>Это вы</Label>
            <Label style={{fontSize:15,lineHeight:20,fontWeight:'700',textAlign:'center'}}>{match.self.displayName}</Label>
          </View>
          <View accessible={false} style={{width:38,height:38,marginTop:compact?24:34,borderRadius:19,backgroundColor:colors.card,borderWidth:1,borderColor:'#e1d7f2',alignItems:'center',justifyContent:'center',transform:[{rotate:'-12deg'}]}}>
            <Svg accessible={false} viewBox="0 0 48 48" width={30} height={30} fill="none">
              <Path d="m14 28 1-18 9 2 12 9-11 14Z" fill={colors.purple} opacity={0.16} />
              <Path d="m14 28 1-18 9 2 12 9-11 14M15 10l10 25m-1-23-4 19m16-10-14 12" stroke={colors.purple} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
              <Path d="m14 28 11 7-4 5a7 7 0 0 1-11-8Z" fill={colors.purple} />
            </Svg>
          </View>
          <View style={{flex:1,minWidth:0,alignItems:'center',gap:6}}>
            <MatchAvatar identity={match.peer} self={false} size={avatarSize} />
            <Label style={{fontSize:11,lineHeight:16,color:colors.secondary}}>Ваш партнёр</Label>
            <Label style={{fontSize:15,lineHeight:20,fontWeight:'700',textAlign:'center'}}>{match.peer.displayName}</Label>
          </View>
        </View>
      </View>
      <View style={{marginTop:'auto',paddingTop:10,gap:8,width:'100%',maxWidth:400,alignSelf:'center'}}>
      <Label accessibilityLiveRegion="polite" style={{fontSize:13,lineHeight:19,color:colors.secondary,textAlign:'center',paddingVertical:8}}>{notice || 'Начните с приветствия и удобного времени.'}</Label>
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
      <Label style={{fontSize:11,lineHeight:17,color:colors.secondary,textAlign:'center',marginTop:compact?10:18}}>Матч не добавляет вас в друзья.{'\n'}Первое сообщение — только по вашему решению.</Label>
      </View>
    </ScrollView></ScreenFrame>
  </Modal>;
}
