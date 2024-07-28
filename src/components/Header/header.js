import React from 'react'
import './header.css'

//Local Time
function localTimeUpdate(){
  let timePeriod = "PM";
  let date = new Date();
  let localHours = date.getUTCHours() + 5;
  let localMinutes = date.getUTCMinutes() + 30;
  if(localMinutes>59){
    localHours += 1;
    localMinutes -= 60;
    if(localMinutes<10){localMinutes = "0" + localMinutes}
  }
  if(localHours<12||localHours>23){
    timePeriod = "AM";
  }
  localHours = localHours%12;
  if(localHours === 0){localHours = 12}
  const shortLocalTime = `${localHours}:${localMinutes} ${timePeriod} GMT +5:30`;
  document.querySelector(".header_LocalTime").innerText = shortLocalTime;
}
setInterval(localTimeUpdate, 1000);

const Header = () => {
  return (
    <div className="header">
        <div className="headerItem itemNAme">
            <ul>
                <li>Local Time</li>
                <li className="header_LocalTime">12:00 AM</li>
            </ul>
        </div>
        <div className="headerItem itemPlace">
            <ul>
                <li>Based in</li>
                <li>Delhi, India</li>
            </ul>
        </div>
        <div className="headerItem itemAval">
            <ul>
                <li>Status</li>
                <li>Available</li>
            </ul>
        </div>
    </div>
  )
}

export default Header