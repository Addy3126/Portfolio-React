import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import $ from 'jquery';
import SmoothScrolling from "./components/SmoothScrolling.tsx";

$(document).on('mousemove', function(e) {
  $('.cursorCustom').css({
    left: e.clientX,
    top: e.clientY,
  });
});

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <SmoothScrolling>
    <App />
    </SmoothScrolling>
  </React.StrictMode>
);