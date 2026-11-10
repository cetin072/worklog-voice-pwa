import { useLocalSearchParams } from 'expo-router';
import HomeScreen from './index';
/** Both existing worklog:// and QA worklog-qa:// schemes route here. No native config change. */
export default function OpenRepeatingWork() {
 const params=useLocalSearchParams<{id?:string;date?:string}>();
 return <HomeScreen initialRepeatWorkId={typeof params.id==='string'?params.id:undefined} initialRepeatDate={typeof params.date==='string'?params.date:undefined}/>;
}
