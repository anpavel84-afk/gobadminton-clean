import { VenuePage } from "../../../components/consumer/venues/VenuePage";
export default async function Page({params}:{params:Promise<{venueId:string}>}) {
  const {venueId}=await params;
  return <VenuePage key={venueId} venueId={venueId}/>;
}
